import { expect, test, type Page } from "@playwright/test";
import { FROZEN_TIME, certifyUiState, expectCertifiedScreenshot } from "./support/app";
import { liveViewportSetup } from "./chart-viewport151.support";

type Theme = "dark" | "light" | "system";
async function setup(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => { if (!error.message.includes("Service worker is disabled because the context is sandboxed")) errors.push(error.message); });
  const transport = await liveViewportSetup(page, false, "/app/live", true);
  await page.route("**/api/settings/chart", route => {
    const item = (key: string) => ({ namespace: "edgelab", key, value: transport.storage.get(key) ?? null, updated_at: "2026-10-10T00:00:00Z" });
    return route.fulfill({ json: { active: item("active-chart-settings-preset.v1"), presets: { ...item("chart-settings-presets.v1"), value: transport.storage.get("chart-settings-presets.v1") ?? [] } } });
  });
  await page.route("**/api/economic-calendar/forex-factory**", route => route.fulfill({ json: {
    provider: "forex_factory", source_url: "https://www.forexfactory.com/calendar", updated_at: "2026-10-10T00:00:00Z", cache_expires_at: "2026-10-11T00:00:00Z", stale: false, events: [],
  } }));
  await page.route("**/api/feedback?**", route => route.fulfill({ json: [] }));
  return { transport, errors };
}
async function resolvedTheme(page: Page, preference: Theme, effective: "dark" | "light") {
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.appThemePreference)).toBe(preference);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.appTheme)).toBe(effective);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(effective);
}
async function chooseTheme(page: Page, theme: Theme) {
  const chooser = page.getByRole("combobox", { name: "App theme", exact: true });
  await expect(chooser).toBeEnabled();
  await chooser.scrollIntoViewIfNeeded();
  await chooser.click();
  await page.getByRole("listbox", { name: "App theme", exact: true }).getByRole("option", { name: theme[0].toUpperCase() + theme.slice(1), exact: true }).click();
}
async function expectFloatingPalette(page: Page, label: string) {
  const menu = page.getByRole("listbox", { name: label, exact: true });
  await expect(menu).toBeVisible();
  const colors = await menu.evaluate(node => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color, floating: style.getPropertyValue("--ui-floating").trim(), primary: style.getPropertyValue("--text-primary").trim() };
  });
  const rgb = (hex: string) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  expect(colors.background).toBe(rgb(colors.floating));
  expect(colors.color).toBe(rgb(colors.primary));
}


async function captureCertificate(page: Page, name: string, failures: string[]) {
  try {
    await expectCertifiedScreenshot(page, page, name, { fullPage: false, animations: "disabled", caret: "hide" });
  } catch (error) {
    const details = await page.evaluate(async () => {
      const violations = (await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations;
      return violations.map((item: any) => ({ id: item.id, nodes: item.nodes.map((node: any) => {
        const element = document.querySelector(node.target.join(" "));
        const style = element ? getComputedStyle(element) : null;
        const matched: string[] = [];
        function visit(rules: CSSRuleList) {
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule && element) {
              try { if (element.matches(rule.selectorText) && (rule.style.color || rule.style.backgroundColor)) matched.push(rule.cssText); } catch { /* Pseudo elements cannot match a node. */ }
            } else if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
          }
        }
        for (const sheet of Array.from(document.styleSheets)) { try { visit(sheet.cssRules); } catch { /* Ignore inaccessible third-party style sheets. */ } }
        return { target: node.target, summary: node.failureSummary, html: node.html, color: style?.color, background: style?.backgroundColor, matched };
      }) }));
    });
    failures.push(name + " : " + String(error) + " details=" + JSON.stringify(details));
  }
}

test("real theme chooser persists dark/light/system, follows device changes, and keeps public pages dark", async ({ page }, info) => {
  const { transport, errors } = await setup(page);
  const failures: string[] = [];
  await resolvedTheme(page, "dark", "dark");
  await transport.waitForAccountWrites();
  await page.goto("/app/settings/appearance");
  const originalChartPresets = structuredClone(transport.storage.get("chart-settings-presets.v1") ?? null);
  await chooseTheme(page, "light");
  await resolvedTheme(page, "light", "light");
  await expect.poll(() => transport.storage.get("settings-center.v1")?.appTheme).toBe("light");
  await expect(page.locator("#setting-app-theme").getByRole("status")).toContainText("Saved");
  await transport.waitForAccountWrites();
  await page.reload();
  await resolvedTheme(page, "light", "light");
  await expect(page.getByRole("combobox", { name: "App theme", exact: true })).toHaveText("Light");
  await transport.waitForAccountWrites();
  await page.goto("/app/position-size");
  await resolvedTheme(page, "light", "light");
  const instrument = page.getByRole("combobox", { name: "Instrument", exact: true });
  await instrument.click();
  await expectFloatingPalette(page, "Instrument");
  await captureCertificate(page, "real-light-instrument-menu.png", failures);
  await instrument.press("Escape");
  await transport.waitForAccountWrites();
  await page.goto("/app/settings/appearance");
  const themeChooser = page.getByRole("combobox", { name: "App theme", exact: true });
  await themeChooser.scrollIntoViewIfNeeded();
  await themeChooser.click();
  await expectFloatingPalette(page, "App theme");
  await captureCertificate(page, "real-light-theme-menu.png", failures);
  await themeChooser.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await chooseTheme(page, "system");
  await resolvedTheme(page, "system", "dark");
  await expect.poll(() => transport.storage.get("settings-center.v1")?.appTheme).toBe("system");
  await page.emulateMedia({ colorScheme: "light" });
  await resolvedTheme(page, "system", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await resolvedTheme(page, "system", "dark");
  await chooseTheme(page, "dark");
  await resolvedTheme(page, "dark", "dark");
  await expect.poll(() => transport.storage.get("settings-center.v1")?.appTheme).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await resolvedTheme(page, "dark", "dark");
  await chooseTheme(page, "light");
  await expect.poll(() => transport.storage.get("settings-center.v1")?.appTheme).toBe("light");
  await transport.waitForAccountWrites();
  expect(transport.storage.get("chart-settings-presets.v1") ?? null).toEqual(originalChartPresets);
  await page.goto("/pricing");
  await expect(page.locator("[data-app-workspace]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.workspaceTheme)).toBeUndefined();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  await page.goto("/app/position-size");
  await resolvedTheme(page, "light", "light");
  expect(errors).toEqual([]);
  await info.attach("real-theme-persistence", { body: JSON.stringify({ saved: transport.storage.get("settings-center.v1"), chartPresetsUnchanged: true, systemChanges: ["dark", "light", "dark"], publicTheme: "dark", failures, errors }), contentType: "application/json" });
  expect(failures, "Opened Light controls retain original certification gates").toEqual([]);
});

test("theme save failure preserves the preview and retries without claiming success", async ({ page }) => {
  const { transport } = await setup(page);
  await transport.waitForAccountWrites();
  await page.goto("/app/settings/appearance");
  transport.failNextPreferenceSave();
  await chooseTheme(page, "light");
  await resolvedTheme(page, "light", "light");
  const row = page.locator("#setting-app-theme");
  await expect(row.getByRole("alert")).toContainText("Save failed");
  await expect(row.getByRole("status")).toHaveCount(0);
  expect(transport.storage.get("settings-center.v1")?.appTheme ?? "dark").toBe("dark");
  await row.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(row.getByRole("status")).toContainText("Saved");
  await expect.poll(() => transport.storage.get("settings-center.v1")?.appTheme).toBe("light");
  await transport.waitForAccountWrites();
  await page.reload();
  await resolvedTheme(page, "light", "light");
});

const inventory = [
  ["/app/accounts", "accounts"], ["/app/economic-calendar", "economic-calendar"], ["/app/feedback", "feedback"],
  ["/app/journal/finance", "finance"], ["/app/journal/playbooks", "journal-playbooks"], ["/app/journal/sessions", "journal-sessions"],
  ["/app/journal/strategies", "journal-strategies"], ["/app/playbooks", "playbooks"], ["/app/position-size", "position-size"],
  ["/app/replay-settings", "replay-settings"], ["/app/results/calendar", "day-review"], ["/app/results/notes", "notes"],
  ["/app/results/overview", "overview"], ["/app/results/trades", "trade-log"], ["/app/strategies", "strategies"],
] as const;
test("real saved light appearance certifies every inventoried workspace page", async ({ page }, info) => {
  test.setTimeout(240_000);
  const { transport, errors } = await setup(page);
  await transport.waitForAccountWrites();
  await page.goto("/app/settings/appearance");
  await chooseTheme(page, "light");
  await expect.poll(() => transport.storage.get("settings-center.v1")?.appTheme).toBe("light");
  const failures: string[] = [];
  for (const [path, label] of inventory) {
    await test.step(path, async () => {
      await transport.waitForAccountWrites();
      await page.goto(path);
      await resolvedTheme(page, "light", "light");
      const main = page.locator("#workspace-content");
      await expect(main.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(main.getByRole("status", { name: "Loading Journal", exact: true })).toHaveCount(0);
      await expect(main.getByText(/^Loading(?:\s|…|\.{3}|$)/i)).toHaveCount(0);
      await captureCertificate(page, `real-light-route-${label}.png`, failures);
      expect(errors, path).toEqual([]);
    });
  }
  await transport.waitForAccountWrites();
  await info.attach("light-route-inventory", { body: JSON.stringify({ selectedThroughRealChooser: true, saved: transport.storage.get("settings-center.v1"), visited: inventory.map(([path]) => path), failures, errors }), contentType: "application/json" });
  expect(failures, "All inventoried Light pages retain the original certification gates").toEqual([]);
});


test("saved light theme reaches the Session gateway and genuine fullscreen chart settings", async ({ page }) => {
  const { transport, errors } = await setup(page);
  const failures: string[] = [];
  await transport.waitForAccountWrites();
  await page.goto("/app/settings/appearance");
  await chooseTheme(page, "light");
  await expect.poll(() => transport.storage.get("settings-center.v1")?.appTheme).toBe("light");
  await transport.waitForAccountWrites();
  await page.goto("/app");
  await resolvedTheme(page, "light", "light");
  await expect(page.getByRole("heading", { level: 1, name: "Continue where the market left you.", exact: true })).toBeVisible();
  await captureCertificate(page, "real-light-session-gateway.png", failures);
  await transport.waitForAccountWrites();
  await page.goto("/app/live");
  await resolvedTheme(page, "light", "light");
  const actions = page.locator("[data-live-chart-actions=true]");
  await expect(actions).toBeVisible();
  await actions.getByRole("button", { name: "Full Screen", exact: true }).click();
  await expect(page.locator(".chart-fullscreen-shell")).toBeVisible();
  await actions.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Chart settings", exact: true });
  await expect(settings).toBeVisible();
  expect(await settings.evaluate(node => getComputedStyle(node).getPropertyValue("--text-primary").trim())).toBe("#172535");
  await captureCertificate(page, "real-light-fullscreen-chart-settings.png", failures);
  await page.getByRole("button", { name: "Close chart settings", exact: true }).click();
  await actions.getByRole("button", { name: "Exit", exact: true }).click();
  await expect(actions.getByRole("button", { name: "Full Screen", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await transport.waitForAccountWrites();
  expect(failures, "Gateway and fullscreen retain original certification gates").toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test("real " + theme + " Commands and mobile More surfaces retain the app palette", async ({ page }, info) => {
    const { transport, errors } = await setup(page);
    const failures: string[] = [];
    await transport.waitForAccountWrites();
    await page.goto("/app/settings/appearance");
    if (theme === "dark") {
      await chooseTheme(page, "light");
      await expect.poll(() => transport.storage.get("settings-center.v1")?.appTheme).toBe("light");
    }
    await chooseTheme(page, theme);
    await resolvedTheme(page, theme, theme);
    await expect.poll(() => transport.storage.get("settings-center.v1")?.appTheme).toBe(theme);
    await transport.waitForAccountWrites();
    await page.goto("/app/position-size");
    await page.getByRole("button", { name: "Open command palette", exact: true }).click();
    const commands = page.getByRole("dialog", { name: "EdgeLab command palette", exact: true });
    await expect(commands).toBeVisible();
    await captureCertificate(page, "real-" + theme + "-commands-dialog.png", failures);
    await commands.getByRole("button", { name: "Close command palette", exact: true }).click();
    await expect(commands).toBeHidden();
    if (info.project.name === "mobile") {
      await page.getByRole("button", { name: "More", exact: true }).click();
      const more = page.getByRole("dialog", { name: "More workspace tools", exact: true });
      await expect(more).toBeVisible();
      await expect(more.getByRole("heading", { name: "More tools", exact: true })).toBeVisible();
      await expect(more.getByText("Pro access", { exact: true })).toBeVisible();
      await expect(more.getByText("Beta access", { exact: true })).toHaveCount(0);
      await captureCertificate(page, "real-" + theme + "-more-drawer.png", failures);
      await more.getByRole("button", { name: "Close more tools", exact: true }).click();
      await expect(more).toBeHidden();
    }
    if (theme === "light") {
      await transport.waitForAccountWrites();
      await page.route("https://data-api.binance.vision/**/ticker/24hr*", route => route.fulfill({ json: ["BTCUSDT", "ETHUSDT"].map(symbol => ({
        symbol, lastPrice: "67512", priceChange: "1", priceChangePercent: ".1", highPrice: "67600", lowPrice: "67400", volume: "1000",
        quoteVolume: "67500000", openPrice: "67500", closeTime: Date.parse(FROZEN_TIME) - 180_000,
      })) }));
      await page.goto("/app/live");
      await resolvedTheme(page, "light", "light");
      const warning = page.locator('.ui-critical-state[data-state="stale"]').filter({ has: page.getByRole("heading", { name: "Market data is stale", exact: true }) });
      await expect(warning).toBeVisible();
      const reconnect = warning.getByRole("button", { name: "Reconnect", exact: true });
      await expect(reconnect).toBeVisible();
      const palette = await reconnect.evaluate(node => { const style = getComputedStyle(node); return { text: style.color, expected: style.getPropertyValue("--on-interaction").trim() }; });
      expect(palette.text).toBe("rgb(255, 255, 255)");
      expect(palette.expected).toBe("#ffffff");
      await captureCertificate(page, "real-light-stale-feed-reconnect.png", failures);
    }
    expect(errors).toEqual([]);
    await transport.waitForAccountWrites();
    await info.attach("real-" + theme + "-shell-surfaces", { body: JSON.stringify({ theme, errors, failures, actualChooser: true, actualDialogs: true }), contentType: "application/json" });
    expect(failures, "Real Commands/More/error-state controls retain all certification gates").toEqual([]);
  });
}
