import { expect, test, type Locator, type Page } from "@playwright/test";
import { certifyUiState, expectCertifiedScreenshot } from "./support/app";
import { liveViewportSetup } from "./chart-viewport151.support";

// The real application stays dark even when the browser prefers light. These
// checks use its default palette without changing the real theme chooser.
async function expectToken(locator: Locator, property: "backgroundColor" | "color" | "borderTopColor", token: string) {
  await expect(locator).toBeVisible();
  const proof = await locator.evaluate((node, { property, token }) => {
    const style = getComputedStyle(node);
    const value = style.getPropertyValue(token).trim();
    const normalized = /^#[0-9a-f]{6}$/i.test(value)
      ? `rgb(${parseInt(value.slice(1, 3), 16)},${parseInt(value.slice(3, 5), 16)},${parseInt(value.slice(5, 7), 16)})`
      : value.replace(/\s/g, "");
    return { actual: style[property].replace(/\s/g, ""), expected: normalized };
  }, { property, token });
  expect(proof.actual, `${property} follows ${token}`).toBe(proof.expected);
}
async function setup(page: Page) {
  const transport = await liveViewportSetup(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.route("**/api/settings/chart", route => {
    const item = (key: string) => ({ namespace: "edgelab", key, value: transport.storage.get(key) ?? null, updated_at: "2026-10-10T00:00:00Z" });
    return route.fulfill({ json: { active: item("active-chart-settings-preset.v1"), presets: { ...item("chart-settings-presets.v1"), value: transport.storage.get("chart-settings-presets.v1") ?? [] } } });
  });
  return transport;
}
async function expectDarkRoot(page: Page) {
  expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: light)").matches)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  await expectToken(page.locator("body"), "backgroundColor", "--ui-canvas");
  await expectToken(page.locator("[data-app-workspace]"), "backgroundColor", "--ui-canvas");
}

test("shared workspace surfaces and trade log follow the existing semantic dark palette", async ({ page }) => {
  const transport = await setup(page);
  await expectDarkRoot(page);
  await expectToken(page.locator(".chart-stage").first(), "backgroundColor", "--ui-surface");
  await expectToken(page.locator(".chart-stage-header").first(), "backgroundColor", "--ui-inset");
  await transport.waitForAccountWrites();
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Continue where the market left you.", exact: true })).toBeVisible();
  await expectDarkRoot(page);
  await expectToken(page.locator(".session-gateway-hero"), "backgroundColor", "--ui-surface");
  await expectToken(page.locator(".session-builder"), "backgroundColor", "--ui-surface");
  await transport.waitForAccountWrites();
  await page.goto("/app/position-size");
  await expectToken(page.locator(".command-header"), "backgroundColor", "--ui-surface");
  await expectToken(page.locator(".terminal-panel").first(), "backgroundColor", "--ui-surface");
  await expectToken(page.locator(".command-header h1"), "color", "--text-primary");
  await expectToken(page.locator(".command-header p"), "color", "--text-secondary");
  await transport.waitForAccountWrites();
  await page.goto("/app/results/trades");
  const log = page.getByRole("region", { name: "Trade log table", exact: true });
  await expectToken(log.locator("thead"), "backgroundColor", "--ui-surface");
  await expectToken(log.locator("thead"), "color", "--text-secondary");
  await expectToken(log.locator("xpath=.."), "backgroundColor", "--ui-surface");
  await expectToken(log.locator("xpath=..").getByRole("heading", { name: "Trade Log", exact: true }), "color", "--text-primary");
  await certifyUiState(page);
  await transport.waitForAccountWrites();
});

test("real opened dropdowns use the default dark floating palette", async ({ page }) => {
  const transport = await setup(page);
  await transport.waitForAccountWrites();
  await page.goto("/app/position-size");
  await expectDarkRoot(page);
  const instrument = page.getByRole("combobox", { name: "Instrument", exact: true });
  await expectToken(instrument, "backgroundColor", "--ui-inset");
  await instrument.click();
  const instrumentMenu = page.getByRole("listbox", { name: "Instrument", exact: true });
  await expectToken(instrumentMenu, "backgroundColor", "--ui-floating");
  await expectToken(instrumentMenu, "color", "--text-primary");
  await expectCertifiedScreenshot(page, page, "position-instrument-open-dark.png", { fullPage: false, animations: "disabled", caret: "hide" });
  await instrument.press("Escape");
  await expect(instrumentMenu).toHaveCount(0);
  await transport.waitForAccountWrites();
  await page.goto("/app/settings/appearance");
  const density = page.getByRole("combobox", { name: "Settings density", exact: true });
  await expect(density).toBeEnabled();
  await density.scrollIntoViewIfNeeded();
  await density.click();
  const densityMenu = page.getByRole("listbox", { name: "Settings density", exact: true });
  await expectToken(densityMenu, "backgroundColor", "--ui-floating");
  await expectToken(densityMenu, "color", "--text-primary");
  await expectCertifiedScreenshot(page, page, "settings-density-open-dark.png", { fullPage: false, animations: "disabled", caret: "hide" });
  await density.press("Escape");
  await expect(densityMenu).toHaveCount(0);
  await transport.waitForAccountWrites();
});
