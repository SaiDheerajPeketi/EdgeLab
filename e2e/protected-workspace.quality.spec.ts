import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { readFileSync } from "node:fs";
import {
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
  seedChartLayout,
} from "./support/app";

const uiPerformanceBudgets = JSON.parse(
  readFileSync(new URL("../docs/ui-performance-budgets.json", import.meta.url), "utf8"),
) as {
  runtime: {
    interactionP95Ms: number;
    sixteenPaneFrameP95Ms: number;
  };
};

function p95(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
}

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

function clusteredPositions(values: number[], tolerance = 2) {
  return [...values].sort((left, right) => left - right).reduce<number[]>((clusters, value) => {
    if (clusters.length === 0 || Math.abs(value - clusters.at(-1)!) > tolerance) {
      clusters.push(value);
    }
    return clusters;
  }, []);
}

async function expectChartPaneGeometry(page: Page, panes: number, columns: number) {
  const shells = page.locator(".chart-pane-grid > .chart-pane-shell");
  await expect(shells).toHaveCount(panes);
  const boxes = await shells.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { height: box.height, left: box.left, top: box.top, width: box.width };
  }));
  const rows = Math.ceil(panes / columns);
  expect(clusteredPositions(boxes.map((box) => box.left))).toHaveLength(columns);
  expect(clusteredPositions(boxes.map((box) => box.top))).toHaveLength(rows);
  expect(Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width))).toBeLessThanOrEqual(2);
  expect(Math.max(...boxes.map((box) => box.height)) - Math.min(...boxes.map((box) => box.height))).toBeLessThanOrEqual(2);
  const viewport = await page.evaluate(() => ({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth + 1);
}

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
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    await page.getByRole("button", { exact: true, name: "Tools" }).click();
    await page.getByRole("radio", { name: "4 × 4 grid · 16 charts" }).click();
    await page.getByRole("button", { exact: true, name: "Tools" }).click();
    await page.getByRole("button", { exact: true, name: "Full Screen" }).click();
    await expect(page.getByRole("button", { exact: true, name: "Exit" })).toBeVisible();
    await expectChartPaneGeometry(page, 16, testInfo.project.name === "mobile" ? 1 : 4);
    await expect(page.locator(".chart-pane-grid")).toHaveScreenshot("chart-fullscreen.png", {
      mask: [page.locator(".chart-plot-column")],
      maskColor: "#0B1118",
    });
  });

  for (const layout of [
    { id: "vertical-2", name: "chart-2-pane", panes: 2 },
    { id: "grid-4", name: "chart-4-pane", panes: 4 },
    { id: "grid-16", name: "chart-16-pane", panes: 16 },
  ] as const) {
    test(`${layout.name} responsive baseline`, async ({ page }, testInfo) => {
      await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
      await page.getByRole("button", { exact: true, name: "Tools" }).click();
      const layoutName = layout.id === "vertical-2" ? "2 columns" : layout.id === "grid-4" ? "2 × 2 grid · 4 charts" : "4 × 4 grid · 16 charts";
      await page.getByRole("radio", { name: layoutName }).click();
      await page.getByRole("button", { exact: true, name: "Tools" }).click();
      const columns = testInfo.project.name === "mobile"
        ? 1
        : layout.id === "grid-16"
          ? testInfo.project.name === "tablet" ? 2 : 4
          : 2;
      await expectChartPaneGeometry(page, layout.panes, columns);
      await expect(page.locator(".chart-pane-grid")).toHaveScreenshot(`${layout.name}.png`, {
        mask: [page.locator(".chart-plot-column")],
        maskColor: "#0B1118",
      });
    });
  }
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

  for (const route of [
    { group: "public", path: "/" },
    { group: "shell", path: "/app" },
    { group: "settings", path: "/app/settings/global" },
    { group: "journal", path: "/app/journal/dashboard" },
    { group: "chart", path: "/app/live" },
  ] as const) {
    test(`kill switch preserves the ${route.group} deep link`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Rollout contract is viewport-independent.");
      await installDeterminism(page, { rollout: "fallback" });
      await gotoStable(page, route.path, { waitForNetworkIdle: false });
      await expect(page).toHaveURL(new RegExp(`${route.path === "/" ? "/$" : `${route.path}$`}`));
      await expect(page.locator(`[data-route-group="${route.group}"]`)).toHaveAttribute("data-ui-version", "fallback");
      await expect(page.getByRole("main")).toBeVisible();
    });
  }

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
    await expect(page.getByRole("heading", { name: "Trade log", level: 1 }).first()).toBeVisible();
    await page.getByLabel("Search symbol, strategy, tag, or note").fill("no matching review");
    await expect(page.getByText(/Showing 0 of 0 filtered trades/)).toBeVisible();
    await page.getByLabel("Search symbol, strategy, tag, or note").fill("");
    await expect(page.getByText(/Showing 1 of 1 filtered trades/)).toBeVisible();
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
  const frameDurations = await page.evaluate(async () => {
    const samples: number[] = [];
    let previous = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < 40; index += 1) {
      const current = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      samples.push(current - previous);
      previous = current;
    }
    return samples;
  });
  const interactionDurations: number[] = [];
  const commandPalette = page.getByRole("dialog", { name: "EdgeLab command palette" });
  for (let sample = 0; sample < 5; sample += 1) {
    interactionDurations.push(await page.evaluate(async () => {
      const start = performance.now();
      const launcher = document.querySelector<HTMLButtonElement>('[aria-label="Open command palette"]');
      if (!launcher) throw new Error("Command palette launcher is unavailable");
      launcher.click();
      while (!document.querySelector('[role="dialog"][aria-label="EdgeLab command palette"]')) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return performance.now() - start;
    }));
    await expect(commandPalette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(commandPalette).toBeHidden();
  }
  const frameP95Ms = p95(frameDurations);
  const interactionP95Ms = p95(interactionDurations);
  await testInfo.attach("low-power-performance.json", {
    body: Buffer.from(JSON.stringify({ frameDurations, frameP95Ms, interactionDurations, interactionP95Ms }, null, 2)),
    contentType: "application/json",
  });
  expect(frameP95Ms).toBeLessThanOrEqual(uiPerformanceBudgets.runtime.sixteenPaneFrameP95Ms);
  expect(interactionP95Ms).toBeLessThanOrEqual(uiPerformanceBudgets.runtime.interactionP95Ms);
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
