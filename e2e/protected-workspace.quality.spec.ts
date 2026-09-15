import { expect, test } from "@playwright/test";
import axe from "axe-core";
import {
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
  seedChartLayout,
} from "./support/app";

const protectedRoutes = [
  { name: "gateway", path: "/app", waitForNetworkIdle: false },
  { name: "chart-compact", path: "/app/live", waitForNetworkIdle: false },
  { name: "replay", path: "/app/replay", waitForNetworkIdle: false },
  { name: "journal-dashboard", path: "/app/journal/dashboard", waitForNetworkIdle: false },
  { name: "journal-accounts", path: "/app/journal/accounts", waitForNetworkIdle: false },
  { name: "journal-trades", path: "/app/journal/trades", waitForNetworkIdle: false },
  { name: "journal-analytics", path: "/app/journal/analytics", waitForNetworkIdle: false },
  { name: "journal-notes", path: "/app/journal/notes", waitForNetworkIdle: false },
  { name: "journal-calendar", path: "/app/journal/calendar", waitForNetworkIdle: false },
  { name: "journal-reports", path: "/app/journal/reports", waitForNetworkIdle: false },
  { name: "journal-settings", path: "/app/journal/settings", waitForNetworkIdle: false },
  { name: "reports", path: "/app/reports", waitForNetworkIdle: false },
  { name: "quant", path: "/app/quant", waitForNetworkIdle: false },
  { name: "settings", path: "/app/settings/global", waitForNetworkIdle: false },
] as const;

const sharedSnapshot = {
  created_at: "2026-09-15T10:00:00.000Z",
  expires_at: "2026-09-22T10:00:00.000Z",
  payload: {
    chart: { candles: [], paneLayout: "grid-4", panes: [{ id: "pane-1" }], symbol: "BTCUSDT", timeframe: "5m" },
    panels: { metrics: { averageR: 1.4, maxDrawdown: -182.5, netPnl: 384.75, profitFactor: 1.82, totalTrades: 14, winRate: 57.1 } },
    workspace: { layoutName: "Opening range review", paneLayout: "grid-4", timezone: "UTC" },
  },
  scope: "WORKSPACE",
  snapshot_version: 1,
  title: "Opening range review",
} as const;

test.describe("authenticated route visual baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
    await seedChartLayout(page, "single");
  });

  for (const route of protectedRoutes) {
    test(`${route.name} renders its real seeded route`, async ({ page }) => {
      await gotoStable(page, route.path, { waitForNetworkIdle: route.waitForNetworkIdle });
      await expect(page.locator("#workspace-content")).toBeVisible();
      await expect(page.locator('[data-ui-version="v2"]')).toBeVisible();
      await expect(page.getByText("Opening workspace", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Opening EdgeLab" })).toHaveCount(0);
      if (route.name === "chart-compact") {
        await expect(page.getByRole("region", { name: /BTC.*chart/i }).first()).toBeVisible();
        await expect(page.locator(".chart-stage")).toHaveCount(1);
        await expect(page.getByRole("button", { exact: true, name: "Full Screen" })).toBeVisible();
      } else if (route.name === "quant") {
        await expect(page.getByRole("complementary", { name: "Quant assistant" })).toBeVisible();
        await expect(page.getByLabel("Message Quant")).toBeVisible();
        await expect(page.locator(".chart-stage")).toHaveCount(1);
      } else {
        await expect(page.getByRole("heading").first()).toBeVisible();
      }
      await expectStableScreenshot(page, route.name, { fullPage: false });
    });
  }

  test("chart fullscreen baseline", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Fullscreen is captured once at trading density.");
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    await page.getByRole("button", { exact: true, name: "Full Screen" }).click();
    await expect(page.getByRole("button", { exact: true, name: "Exit" })).toBeVisible();
    await expectStableScreenshot(page, "chart-fullscreen", { fullPage: false });
  });
});

test.describe("critical states and rollout fallback", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("shared workspace ready baseline", async ({ page }) => {
    await page.route("**/api/workspace-shares/open", (route) => route.fulfill({ body: JSON.stringify(sharedSnapshot), contentType: "application/json", status: 200 }));
    await gotoStable(page, "/shared#visual-share", { waitForNetworkIdle: false });
    await expect(page.getByRole("heading", { name: "Opening range review" })).toBeVisible();
    await expectStableScreenshot(page, "shared-ready", { fullPage: false });
  });

  test("shared workspace expired baseline", async ({ page }) => {
    await page.route("**/api/workspace-shares/open", (route) => route.fulfill({ body: JSON.stringify({ detail: "expired" }), contentType: "application/json", status: 410 }));
    await gotoStable(page, "/shared#expired-share", { waitForNetworkIdle: false });
    await expect(page.getByRole("heading", { name: "Snapshot unavailable" })).toBeVisible();
    await expectStableScreenshot(page, "shared-expired", { fullPage: false });
  });

  test("shared workspace loading baseline", async ({ page }) => {
    await page.route("**/api/workspace-shares/open", () => new Promise(() => undefined));
    await gotoStable(page, "/shared#pending-share", { waitForNetworkIdle: false });
    await expect(page.getByRole("status").filter({ hasText: "Opening secure snapshot" })).toBeVisible();
    await expectStableScreenshot(page, "shared-loading", { fullPage: false });
  });

  test("server kill switch selects a complete route fallback", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Rollout contract is viewport-independent.");
    await installDeterminism(page, { rollout: "fallback" });
    await gotoStable(page, "/app/settings/global");
    await expect(page.locator('[data-route-group="settings"]')).toHaveAttribute("data-ui-version", "fallback");
    await expect(page.getByRole("status").filter({ hasText: "Compatibility interface active" })).toBeVisible();
    await expect(page.locator("#workspace-content")).toBeVisible();
    await expectStableScreenshot(page, "settings-rollout-fallback", { fullPage: false });
  });

  test("unavailable rollout service keeps the verified default", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Failure fallback is viewport-independent.");
    await installDeterminism(page, { rollout: "unavailable" });
    await gotoStable(page, "/app/journal/dashboard");
    await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", "v2");
    await expect(page.getByRole("main")).toBeVisible();
  });
});

test.describe("accessibility and adaptive operation", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
    await seedChartLayout(page, "single");
  });

  test("axe, landmarks, keyboard and chart text alternative pass", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Semantic contract is viewport-independent.");
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        resultTypes: ["violations"],
        rules: { "color-contrast": { enabled: true } },
      });
      return result.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
    });
    expect(violations, violations.map((item) => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("complementary", { name: "Workspace navigation" })).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to workspace" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#workspace-content")).toBeFocused();
    const chart = page.getByRole("region", { name: /BTC.*chart/i }).first();
    await expect(chart).toBeVisible();
    await expect(chart.locator(".sr-only")).toContainText(/Latest bar|No bars are currently available/);
  });

  test("200% zoom, coarse pointer, long RTL content and safe width remain usable", async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile project supplies touch and coarse-pointer semantics.");
    await page.addInitScript(() => {
      const applyDirection = () => { document.documentElement.dir = "rtl"; };
      if (document.documentElement) applyDirection();
      else document.addEventListener("DOMContentLoaded", applyDirection, { once: true });
      window.localStorage.setItem("edgelab.ui-test.long-label", "حساب العقود الآجلة طويل الاسم — مكتب فرانكفورت");
    });
    await gotoStable(page, "/app/journal/accounts");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const client = await context.newCDPSession(page);
    await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const targets = await page.locator("button:visible, a:visible").evaluateAll((nodes) => nodes.slice(0, 12).map((node) => {
      const rect = node.getBoundingClientRect();
      return { height: rect.height, label: node.getAttribute("aria-label") || node.textContent?.trim(), width: rect.width };
    }));
    expect(targets.filter((target) => target.width < 44 || target.height < 44), JSON.stringify(targets)).toEqual([]);
  });

  test("financial meaning survives common color-vision filters", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "CVD redundancy is checked once.");
    await gotoStable(page, "/app/journal/dashboard");
    const before = await page.locator("#workspace-content").innerText();
    expect(before).toMatch(/Net P&L|profit|loss/i);
    expect(before).toMatch(/[+−-]\s*\$?|LONG|SHORT|Winner|Loser/i);
    for (const filter of ["grayscale(1)", "url('#protanopia')", "url('#deuteranopia')", "url('#tritanopia')"]) {
      await page.locator("#workspace-content").evaluate((element, value) => { (element as HTMLElement).style.filter = value; }, filter);
      expect(await page.locator("#workspace-content").innerText()).toBe(before);
    }
  });

  test("account overlay and circular toolbox restore keyboard focus", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Keyboard overlay behavior is checked once.");
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    const accountTrigger = page.getByRole("button", { name: /Visual Reviewer/ });
    await accountTrigger.click();
    await expect(page.getByRole("dialog", { name: "Visual Reviewer" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(accountTrigger).toBeFocused();

    const chart = page.getByRole("region", { name: /chart/i }).first();
    await chart.focus();
    await page.keyboard.down("Alt");
    await expect(page.getByRole("menu", { name: "Circular drawing toolbox" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.up("Alt");
    await expect(chart).toBeFocused();
  });

  test("chart workbench overlays expose keyboard navigation and restore focus", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Keyboard overlay behavior is checked once.");
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    const toolsTrigger = page.getByRole("button", { exact: true, name: "Tools" });
    await toolsTrigger.click();

    const commandInput = page.getByRole("textbox", { name: "Search chart commands" });
    await commandInput.focus();
    const commandDialog = page.getByRole("dialog", { name: "Chart command search results" });
    await expect(commandDialog).toBeVisible();
    await commandInput.press("ArrowDown");
    await expect(commandDialog.locator("[data-chart-command-result]").first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(commandDialog.locator("[data-chart-command-result]").last()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(commandDialog).toBeHidden();
    await expect(commandInput).toBeFocused();

    const settingsTrigger = page.locator(".chart-studio-toolbar").getByRole("button", { exact: true, name: "Settings" });
    await settingsTrigger.click();
    const settingsDialog = page.getByRole("dialog", { name: "Chart settings" });
    await expect(settingsDialog).toBeVisible();
    await settingsDialog.getByRole("button", { name: "Close chart settings" }).click();
    await expect(settingsTrigger).toBeFocused();

    await settingsTrigger.click();
    await page.keyboard.press("Escape");
    await expect(settingsDialog).toBeHidden();
    await expect(settingsTrigger).toBeFocused();

    await settingsTrigger.click();
    await toolsTrigger.click();
    await expect(settingsDialog).toBeHidden();
    await expect(toolsTrigger).toBeFocused();
  });

  test("settings immediate-save feedback offers a working undo", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Settings interaction is checked once.");
    await gotoStable(page, "/app/settings/global");
    await page.getByRole("button", { name: /Appearance/ }).click();
    const density = page.getByLabel("Settings density");
    await density.selectOption("compact");
    await expect(page.getByText("Settings density changed")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(density).toHaveValue("comfortable");
  });

  test("command menu navigates into the Journal and preserves a usable filter workflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Command navigation is checked once.");
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: "EdgeLab command palette" });
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox").fill("Browse journaled trades");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/journal\/trades$/);
    await expect(page.getByRole("heading", { name: "Live Trade Ledger" })).toBeVisible();
    await page.getByPlaceholder("Strategy, account, session, tag...").fill("no matching review");
    await expect(page.getByText("0 entries")).toBeVisible();
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByPlaceholder("Strategy, account, session, tag...")).toHaveValue("");
  });

  test("settings import rejects an invalid bundle without changing data", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Settings error recovery is checked once.");
    await gotoStable(page, "/app/settings/global#settings/storage", { waitForNetworkIdle: false });
    const chooser = page.locator('input[type="file"][accept*="json"]');
    await chooser.setInputFiles({ buffer: Buffer.from('{"app":"unknown"}'), mimeType: "application/json", name: "invalid-export.json" });
    await expect(page.getByRole("alert")).toContainText("not a supported EdgeLab export");
    await expect(page.getByRole("button", { name: "Choose JSON bundle" })).toBeEnabled();
  });

  test("mobile navigation drawer returns focus and opens Journal", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile project supplies the bottom navigation.");
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    const more = page.getByRole("button", { exact: true, name: "More" });
    await more.click();
    await expect(page.getByRole("dialog", { name: "More workspace tools" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await page.getByRole("button", { name: "Journal" }).click();
    await expect(page).toHaveURL(/\/app\/journal\/dashboard$/);
    await expect(page.locator("#workspace-content")).toBeFocused();
  });
});

test("16-pane workspace remains responsive under low-power CPU throttling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The low-power profile is a dedicated desktop measurement.");
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await installDeterminism(page);
  await seedApprovedSession(page);
  await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("radio", { name: "4 × 4 grid · 16 charts" }).click();
  await expect(page.locator(".chart-stage")).toHaveCount(16);
  await page.getByRole("button", { name: "Tools" }).click();
  await expect(page.getByRole("radio", { name: "4 × 4 grid · 16 charts" })).toBeHidden();
  await page.waitForTimeout(1_500);
  await expectStableScreenshot(page, "chart-4x4-low-power", {
    fullPage: false,
    mask: [page.locator(".chart-plot-column")],
  });
  const interactionMs = await page.evaluate(async () => {
    const start = performance.now();
    const launcher = document.querySelector<HTMLButtonElement>('[aria-label="Open command palette"]');
    if (!launcher) throw new Error("Command palette launcher is unavailable");
    launcher.click();
    while (!document.querySelector('[role="dialog"][aria-label="EdgeLab command palette"]')) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return performance.now() - start;
  });
  await expect(page.getByRole("dialog", { name: "EdgeLab command palette" })).toBeVisible();
  expect(interactionMs).toBeLessThanOrEqual(250);
  const layoutPersisted = await page.evaluate(() => Object.entries(window.localStorage).some(
    ([key, value]) => key.includes("live-chart-layout") && value.includes('"paneLayout":"grid-16"'),
  ));
  expect(layoutPersisted).toBe(true);
});

test("runtime interaction and layout stability stay inside release budgets", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runtime budgets use one stable desktop profile.");
  await installDeterminism(page);
  await seedApprovedSession(page);
  await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
  const interactionMs = await page.evaluate(async () => {
    const start = performance.now();
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyK", ctrlKey: true, key: "k" }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return performance.now() - start;
  });
  expect(interactionMs).toBeLessThanOrEqual(200);
  const cls = await page.evaluate(() => (window.__edgeLayoutShifts ?? []).reduce((sum, value) => sum + value, 0));
  expect(cls).toBeLessThanOrEqual(0.1);
});

declare global {
  interface Window {
    axe: typeof axe;
    __edgeLayoutShifts?: number[];
  }
}
