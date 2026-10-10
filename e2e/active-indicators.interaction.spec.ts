import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { certifyUiState } from "./support/app";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String)
  .filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort()
  .map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
async function activate(control: Locator, touch: boolean) {
  await control.scrollIntoViewIfNeeded();
  if (touch) await control.tap(); else await control.click();
}
async function chooseTheme(page: Page, theme: "light" | "dark") {
  await page.goto("/app/settings/appearance");
  await page.getByRole("combobox", { name: "App theme", exact: true }).click();
  await page.getByRole("listbox", { name: "App theme", exact: true })
    .getByRole("option", { name: theme === "light" ? "Light" : "Dark", exact: true }).click();
  await expect(page.locator("#setting-app-theme").getByRole("status")).toContainText("Saved");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.appTheme)).toBe(theme);
}

for (const theme of ["dark", "light"] as const) test(`${theme}: every installed indicator remains operable beyond five, including hidden studies and suppressed readouts`, async ({ page }, info) => {
  const beforeSeal = seal(), touch = info.project.name === "mobile", errors: string[] = [];
  page.on("pageerror", error => { if (!error.message.includes("Service worker is disabled because the context is sandboxed")) errors.push(error.message); });
  const feed = await liveViewportSetup(page, false, "/app/live", true);
  await feed.waitForAccountWrites();
  // The default Dark choice is unchanged, so prove a real saved transition first.
  if (theme === "dark") {
    await chooseTheme(page, "light");
    await feed.waitForAccountWrites();
  }
  await chooseTheme(page, theme);
  await feed.waitForAccountWrites();
  await page.goto("/app/live");
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  const stage = page.locator(".chart-stage").first(), trigger = stage.locator(".chart-active-indicator-trigger");
  const initial = Number((await trigger.innerText()).match(/\((\d+)\)/)![1]);
  const libraryButton = page.getByRole("button", { name: "Indicators", exact: true });
  if (!await libraryButton.isVisible()) await activate(page.getByRole("button", { name: "Tools", exact: true }).first(), touch);
  await activate(libraryButton, touch);
  const library = page.getByRole("dialog", { name: "Indicator library", exact: true });
  await library.getByRole("searchbox", { name: "Search indicators by name, description, category, or synonym", exact: true }).fill("EMA");
  for (let index = 0; index < 12; index++) await activate(library.getByRole("button", { name: /^Add (another )?EMA indicator/ }), touch);
  await activate(library.getByRole("button", { name: "Close indicator library", exact: true }), touch);
  const total = initial + 12;
  await expect(trigger).toContainText(`(${total})`);
  // This is the original omission: all data-ready EMA legends must exist beyond index five.
  await expect(stage.locator("button.chart-study-pill").filter({ hasText: "EMA 20" })).toHaveCount(total);
  const legendHeight = await stage.locator(".chart-study-row").evaluate(node => node.getBoundingClientRect().height);
  expect(legendHeight).toBeLessThanOrEqual(88);
  const plot = stage.locator(".tv-lightweight-charts").first(), plotHeight = (await plot.boundingBox())!.height;
  expect(plotHeight).toBeGreaterThanOrEqual(touch ? 260 : 568);
  await activate(trigger, touch);
  const menu = page.getByRole("dialog", { name: "Active indicators", exact: true });
  await expect(menu.locator("li")).toHaveCount(total);
  await expect(menu.locator("[data-indicator-settings]").first()).toBeFocused();
  const ids = await menu.locator("li").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-active-indicator-id")));
  expect(new Set(ids).size).toBe(total);
  const lastId = ids.at(-1)!, last = menu.locator(`[data-active-indicator-id="${lastId}"]`);
  await activate(last.getByRole("button", { name: "Hide EMA 20", exact: true }), touch);
  await expect(last.getByRole("button", { name: "Show EMA 20", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(last).toContainText("Hidden");
  await expect(stage.locator("button.chart-study-pill").filter({ hasText: "EMA 20" })).toHaveCount(total - 1);
  await certifyUiState(page);
  const directory = path.resolve(".artifacts/active-indicators", info.project.name); fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${theme}-all-indicators.png`), animations: "disabled" });
  await activate(last.getByRole("button", { name: "Show EMA 20", exact: true }), touch);
  await expect(stage.locator("button.chart-study-pill").filter({ hasText: "EMA 20" })).toHaveCount(total);
  // Traverse the actual nonmodal popup using native Tab; mobile includes an explicit hybrid keyboard probe.
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await trigger.press("Enter"); await expect(menu.locator("[data-indicator-settings]").first()).toBeFocused();
  for (let index = 0; index < (total - 1) * 3; index++) await page.keyboard.press("Tab");
  await expect(last.getByRole("button", { name: "Settings for EMA 20", exact: true })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(menu).toBeHidden();
  const settings = page.getByRole("group", { name: "Indicator settings", exact: true });
  await expect(settings).toBeVisible();
  await expect.poll(() => settings.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await settings.getByLabel("Period", { exact: true }).fill("37");
  await settings.getByLabel("Period", { exact: true }).press("Enter");
  await expect(settings).toContainText("EMA 37");
  await certifyUiState(page);
  await page.screenshot({ path: path.join(directory, `${theme}-late-indicator-settings.png`), animations: "disabled" });
  await activate(settings.getByRole("button", { name: "Close indicator settings", exact: true }), touch);
  await expect(trigger).toBeFocused();
  await activate(trigger, touch);
  await activate(menu.locator(`[data-active-indicator-id="${lastId}"]`).getByRole("button", { name: "Remove EMA 37", exact: true }), touch);
  await expect(menu.locator("li")).toHaveCount(total - 1);
  await expect(menu.locator(`[data-active-indicator-id="${lastId}"]`)).toHaveCount(0);
  await expect(menu.locator("[data-indicator-settings]").last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  const chartSettingsButton = page.getByRole("button", { name: "Settings", exact: true }).first();
  if (!await chartSettingsButton.isVisible()) await activate(page.getByRole("button", { name: "Tools", exact: true }).first(), touch);
  await activate(chartSettingsButton, touch);
  const chartSettings = page.getByRole("dialog", { name: "Chart settings", exact: true });
  await activate(chartSettings.getByRole("button", { name: "Status line", exact: true }), touch);
  await chartSettings.getByRole("checkbox", { name: "Indicator titles", exact: true }).uncheck();
  await chartSettings.getByRole("checkbox", { name: "Indicator values", exact: true }).uncheck();
  await activate(chartSettings.getByRole("button", { name: "Close chart settings", exact: true }), touch);
  await expect(stage.getByRole("region", { name: "Indicator values", exact: true })).toHaveCount(0);
  await activate(trigger, touch); await expect(menu.locator("li")).toHaveCount(total - 1);
  await certifyUiState(page); await page.keyboard.press("Escape");
  expect((await plot.boundingBox())!.height).toBeGreaterThanOrEqual(plotHeight);
  expect(errors).toEqual([]); expect(seal()).toBe(beforeSeal);
  fs.writeFileSync(path.join(directory, `${theme}-evidence.json`), JSON.stringify({ scope: "Actual production chart/library/settings and keyboard/touch controls; controlled auth, storage and OHLC provider transport only",
    theme, project: info.project.name, initial, total, ids, removedId: lastId, legendHeight, plotHeight, keyboard: "Native Enter/Tab/Escape; mobile hybrid keyboard probe", errors,
    beforeSeal, afterSeal: seal(), certification: "Unchanged shared WCAG 2.2 AA, comfortable/compact, <=1px overflow and coarse 44px gates",
    fixtures: Object.fromEntries(["e2e/active-indicators.config.ts", "e2e/active-indicators.interaction.spec.ts"].map(file => [file, hash(fs.readFileSync(file))])) }, null, 2));
});
