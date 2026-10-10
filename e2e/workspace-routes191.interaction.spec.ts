import { expect, test, type Page } from "@playwright/test";
import { certifyUiState, expectCertifiedScreenshot } from "./support/app";
import { liveViewportSetup } from "./chart-viewport151.support";

const routes = [
  { path: "/app/accounts", label: "Backtest Accounts & Imports", screenshot: "workspace-route-accounts.png" },
  { path: "/app/economic-calendar", label: "Forex Factory Calendar", screenshot: "workspace-route-economicCalendar.png" },
  { path: "/app/feedback", label: "Tell Us What To Fix", screenshot: "workspace-route-feedback.png" },
  { path: "/app/journal/finance", label: "Income & Expense Tracker", screenshot: "workspace-route-financeTracker.png" },
  { path: "/app/journal/playbooks", label: "Analytics", screenshot: "workspace-route-journalPlaybooks.png" },
  { path: "/app/journal/sessions", label: "Analytics", screenshot: "workspace-route-journalSessions.png" },
  { path: "/app/journal/strategies", label: "Analytics", screenshot: "workspace-route-journalStrategies.png" },
  { path: "/app/playbooks", label: "Backtest Rule Library", screenshot: "workspace-route-playbooks.png" },
  { path: "/app/position-size", label: "Position Size Calculator", screenshot: "workspace-route-positionSizeCalculator.png" },
  { path: "/app/replay-settings", label: "Settings", screenshot: "workspace-route-settings.png" },
  { path: "/app/results/calendar", label: "Backtest Daily Review", screenshot: "workspace-route-dayView.png" },
  { path: "/app/results/notes", label: "Backtest Trade Notes", screenshot: "workspace-route-notebook.png" },
  { path: "/app/results/overview", label: "Backtest Command Center", screenshot: "workspace-route-dashboard.png" },
  { path: "/app/results/trades", label: "Backtest Trade Log", screenshot: "workspace-route-tradeView.png" },
  { path: "/app/strategies", label: "Backtest Strategy Performance", screenshot: "workspace-route-strategies.png" },
] as const;

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => {
    if (!error.message.includes("Service worker is disabled because the context is sandboxed")) errors.push(error.message);
  });
  return errors;
}

async function setup(page: Page) {
  const transport = await liveViewportSetup(page);
  // These are HTTP models consumed by the real pages, not component overrides.
  await page.route("**/api/economic-calendar/forex-factory**", route => route.fulfill({ json: {
    provider: "forex_factory", source_url: "https://www.forexfactory.com/calendar",
    updated_at: "2026-10-10T00:00:00Z", cache_expires_at: "2026-10-11T00:00:00Z", stale: false, events: [],
  } }));
  await page.route("**/api/feedback?**", route => route.fulfill({ json: [] }));
  await page.route("**/api/settings/chart", route => {
    const item = (key: string) => ({ namespace: "edgelab", key, value: transport.storage.get(key) ?? null, updated_at: "2026-10-10T00:00:00Z" });
    return route.fulfill({ json: { active: item("active-chart-settings-preset.v1"), presets: { ...item("chart-settings-presets.v1"), value: transport.storage.get("chart-settings-presets.v1") ?? [] } } });
  });
  return transport;
}

async function settledHeader(page: Page, label: string) {
  const main = page.locator("main#workspace-content");
  const heading = main.getByRole("heading", { level: 1 });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveText(label);
  await expect(heading).toBeVisible();
  await expect(main.locator('header[aria-label="Workspace context"]')).toHaveCount(0);
  await expect(main).not.toContainText(/Live connection|Saved workspace|Return to replay sessions/);
  await expect(main.locator(".command-header").getByText("EL", { exact: true })).toHaveCount(0);
  if (new URL(page.url()).pathname === "/app/replay-settings") {
    await expect(main.getByRole("button", { name: "Back to Backtest", exact: true })).toHaveCount(0);
  }
  await expect(main.getByRole("status", { name: "Loading Journal", exact: true })).toHaveCount(0);
  await expect(main.getByText(/^Loading(?:\s|…|\.{3}|$)/i)).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await heading.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
}

test("canonical workspace routes render settled production pages at the default viewport", async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page), transport = await setup(page);
  const visited = new Set<string>();
  for (const route of routes) {
    await test.step(route.path, async () => {
      await transport.waitForAccountWrites();
      await page.goto(route.path);
      await expect.poll(() => new URL(page.url()).pathname).toBe(route.path);
      await settledHeader(page, route.label);
      await transport.waitForAccountWrites();
      expect(errors, `Runtime errors on ${route.path}`).toEqual([]);
      await expectCertifiedScreenshot(page, page, route.screenshot, { fullPage: false, animations: "disabled", caret: "hide" });
      const scrollRegion = ({
        "/app/journal/finance": "Income and expense history",
        "/app/position-size": "Position size lot ladder",
        "/app/results/trades": "Trade log table",
      } as Partial<Record<string, string>>)[route.path];
      if (scrollRegion) {
        const region = page.getByRole("region", { name: scrollRegion, exact: true });
        await expect(region).toHaveAttribute("tabindex", "0");
        if (await region.evaluate(node => node.scrollWidth > node.clientWidth)) {
          await region.focus();
          await expect(region).toBeFocused();
          const before = await region.evaluate(node => node.scrollLeft);
          await region.press("ArrowRight");
          await expect.poll(() => region.evaluate(node => node.scrollLeft)).toBeGreaterThan(before);
          await info.attach(`${route.screenshot}-keyboard-scroll`, { body: JSON.stringify({
            name: scrollRegion, before, after: await region.evaluate(node => node.scrollLeft),
          }), contentType: "application/json" });
        }
      }
      visited.add(new URL(page.url()).pathname);
    });
  }
  expect(visited.size).toBe(15);
  expect(errors).toEqual([]);
});

async function openEconomicCalendar(page: Page) {
  const sidebar = page.getByRole("navigation", { name: "Trading workspace", exact: true });
  if (await sidebar.isVisible()) {
    await sidebar.getByRole("button", { name: /Economic calendar$/ }).click();
  } else {
    await page.getByRole("navigation", { name: "Primary workspace", exact: true }).getByRole("button", { name: /More/ }).click();
    await page.getByRole("dialog", { name: "More workspace tools", exact: true }).getByRole("button", { name: /Economic calendar/ }).click();
  }
}

test("canonical navigation survives browser back, forward and reload", async ({ page }) => {
  const errors = collectErrors(page), transport = await setup(page);
  await transport.waitForAccountWrites();
  await page.goto("/app/position-size");
  await settledHeader(page, "Position Size Calculator");
  await transport.waitForAccountWrites();
  await openEconomicCalendar(page);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/app/economic-calendar");
  await settledHeader(page, "Forex Factory Calendar");
  await transport.waitForAccountWrites();
  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/app/position-size");
  await settledHeader(page, "Position Size Calculator");
  await transport.waitForAccountWrites();
  await page.goForward();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/app/economic-calendar");
  await settledHeader(page, "Forex Factory Calendar");
  await transport.waitForAccountWrites();
  await page.reload();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/app/economic-calendar");
  await settledHeader(page, "Forex Factory Calendar");
  await transport.waitForAccountWrites();
  expect(errors).toEqual([]);
});


test("feedback native choices expose genuine 44px label targets", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "The native label hit target is checked on coarse pointers.");
  const transport = await setup(page);
  await page.goto("/app/feedback");
  await settledHeader(page, "Tell Us What To Fix");
  await transport.waitForAccountWrites();
  const evidence = [];
  for (const name of [/^Include current session context/, /^Attach HAR network logs/]) {
    const input = page.getByRole("checkbox", { name });
    const label = input.locator("xpath=ancestor::label");
    await label.scrollIntoViewIfNeeded();
    const proof = await input.evaluate((node: HTMLInputElement) => {
      const label = node.closest("label")!;
      const rect = label.getBoundingClientRect(), inputRect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { label: label.textContent?.trim(), width: rect.width, height: rect.height,
        input: { width: inputRect.width, height: inputRect.height },
        inside: inputRect.left >= rect.left && inputRect.right <= rect.right && inputRect.top >= rect.top && inputRect.bottom <= rect.bottom,
        associated: node.labels != null && Array.from(node.labels).includes(label),
        hit: hit != null && label.contains(hit), inert: label.closest("[inert]") != null };
    });
    expect(proof.width).toBeGreaterThanOrEqual(44);
    expect(proof.height).toBeGreaterThanOrEqual(44);
    expect(proof.inside && proof.associated && proof.hit && !proof.inert).toBe(true);
    const checked = await input.isChecked();
    await label.tap();
    await expect(input).toBeChecked({ checked: !checked });
    await label.tap();
    await expect(input).toBeChecked({ checked });
    evidence.push(proof);
  }
  console.log(JSON.stringify({ project: info.project.name, feedbackLabelTargets: evidence }));
  await info.attach("feedback-label-targets", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
});


test("native choice certification retains real target and negative label guards", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "This target contract applies to coarse pointers.");
  const documentFor = (controls: string) => `<!doctype html><html lang="en"><head><title>Native choice target contract</title></head><body><main><h1>Native choice target contract</h1>${controls}</main></body></html>`;
  await page.setContent(documentFor('<input type="checkbox" aria-label="Standalone choice" style="width:44px;height:44px">'));
  await certifyUiState(page);
  for (const controls of [
    '<input type="checkbox" aria-label="Small standalone choice" style="width:16px;height:16px">',
    '<div style="width:44px;height:44px"><input type="checkbox" aria-label="Arbitrary ancestor choice" style="width:16px;height:16px"></div>',
    '<label style="display:block;position:relative;width:44px;height:44px"><input type="checkbox" aria-label="Covered label choice" style="width:16px;height:16px"></label><span aria-hidden="true" style="position:fixed;inset:0;z-index:1"></span>',
  ]) {
    await page.setContent(documentFor(controls));
    await expect(certifyUiState(page)).rejects.toThrow(/coarse-pointer targets below 44px/);
  }
});
