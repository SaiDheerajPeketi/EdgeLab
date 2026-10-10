import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { liveViewportSetup } from "./chart-viewport151.support";

const palette = { "--ui-surface": "#eee6d9", "--ui-inset": "#ded5c8", "--ui-raised": "#e8dfd2", "--ui-hover": "#cfc2b2",
  "--ui-selection": "#b6cce0", "--ui-border-subtle": "#887766", "--ui-border-strong": "#665544", "--ui-focus": "#704099",
  "--text-primary": "#18293a", "--text-secondary": "#405162", "--text-accent": "#493060",
  "--profit-text": "#155d34", "--loss-text": "#8c2034", "--warning-text": "#704510" };
async function header(page: Page, label: string) {
  const context = page.locator('header[aria-label="Workspace context"]');
  await expect(context.getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible();
  await expect(context.getByRole("button")).toHaveCount(0);
  await expect(context).not.toContainText(/Live connection|Saved workspace|Return to replay sessions/);
  expect(await context.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
}
test("workspace pages use their sidebar navigation without redundant Back controls or invented connection labels", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => { if (!error.message.includes("Service worker is disabled because the context is sandboxed")) errors.push(error.message); });
  const transport = await liveViewportSetup(page);
  await expect(page.getByRole("heading", { level: 1, name: "Live Chart Watchlists", exact: true })).toBeVisible();
  await expect(page.locator('header[aria-label="Workspace context"]')).toHaveCount(0);
  const directory = path.resolve(".artifacts/navigation191", info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, "live-chart-space.png"), animations: "disabled" });
  await page.route("**/api/market-data/instruments**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/instruments")) return route.fulfill({ json: [{ id: 17, canonical_symbol: "ESU26", display_name: "E-mini S&P 500",
      asset_class: "FUTURES", instrument_type: "FUTURE", exchange: "CME", currency: "USD", timezone: "America/Chicago",
      tick_size: ".25", active: true, identifiers: [{ provider: "licensed-futures", provider_symbol: "ESU26" }] }] });
    if (url.pathname.endsWith("/footprints")) {
      const now = Date.now();
      return route.fulfill({ json: [{ id: 171, instrument_id: 17, contract_id: null, provider: "licensed-futures", interval_seconds: 300,
        start_at: new Date(now - 300_000).toISOString(), end_at: new Date(now).toISOString(), tick_size: ".25", bid_volume: "100",
        ask_volume: "125", unknown_volume: "0", total_volume: "225", delta: "25", trade_count: 9, average_trade_size: "25", complete: true,
        levels: [{ price: "6500.25", bid_volume: "100", ask_volume: "125", unknown_volume: "0", total_volume: "225",
          delta: "25", trade_count: 9, average_trade_size: "25" }] }] });
    }
    return route.fallback();
  });
  await transport.waitForAccountWrites();
  await page.goto("/app/order-flow");
  await header(page, "Order flow");
  await expect(page.locator('[data-order-flow-source="persisted-provider-footprint"]')).toBeVisible();
  await expect(page.getByRole("cell", { name: "125", exact: true })).toBeVisible();
  const primary = page.getByRole("navigation", { name: "Primary workspace", exact: true });
  if (info.project.name !== "desktop") await expect(primary.getByRole("button", { name: /Live/ })).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: path.join(directory, "order-flow-clean-header.png"), animations: "disabled" });
  const region = page.locator("[data-order-flow-state]");
  await region.evaluate((node, palette) => { for (const [name, value] of Object.entries(palette)) (node as HTMLElement).style.setProperty(name, value); }, palette);
  const probes = [];
  for (const name of ["Instrument", "Timeframe", "Provider"]) {
    const input = page.getByRole("combobox", { name, exact: true });
    const probe = await input.evaluate(node => { const style = getComputedStyle(node); return {
      background: style.backgroundColor, color: style.color, border: style.borderTopColor, height: node.getBoundingClientRect().height }; });
    expect(probe.background).toBe("rgb(222, 213, 200)"); expect(probe.color).toBe("rgb(24, 41, 58)");
    expect(probe.height).toBeGreaterThanOrEqual(44); probes.push({ name, ...probe });
  }
  await page.screenshot({ path: path.join(directory, "order-flow-palette-inheritance.png"), animations: "disabled" });
  const routes = [["/app", "Replay sessions"], ["/app/reports", "Metrics"], ["/app/journal/accounts", "Trading accounts"], ["/app/settings/global", "Workspace settings"]];
  for (const [route, label] of routes) { await transport.waitForAccountWrites(); await page.goto(route); await header(page, label); }
  // Settings remain accessible through the real navigation after removing their header shortcut.
  if (info.project.name !== "desktop") {
    await primary.getByRole("button", { name: /More/ }).click();
    const drawer = page.getByRole("dialog", { name: "More workspace tools", exact: true });
    await drawer.getByRole("button", { name: /Order flow/, exact: false }).click();
    await expect(page).toHaveURL(/\/app\/order-flow$/);
    await header(page, "Order flow");
  } else {
    await page.getByRole("navigation", { name: "Trading workspace", exact: true }).getByRole("button", { name: /Order flow/ }).click();
    await expect(page).toHaveURL(/\/app\/order-flow$/);
    await header(page, "Order flow");
  }
  await transport.waitForAccountWrites();
  await page.reload();
  await header(page, "Order flow");
  await transport.waitForAccountWrites();
  await page.goto("/missing-navigation191");
  await expect(page.getByRole("heading", { name: "Page not found.", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View pricing", exact: true })).toHaveAttribute("href", "/pricing");
  await expect(page.locator("main")).not.toContainText(/beta availability|Review beta access|route unavailable/);
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(directory, "receipt.json"), JSON.stringify({ routes: [["/app/live", "Live markets"], ["/app/order-flow", "Order flow"], ...routes],
    errors, themeProbes: probes, navigationWorked: true, qualification: "Actual production pages/navigation, controlled authenticated API/provider transport. Palette injection tests CSS inheritance, not a light-mode chooser." }, null, 2));
});
