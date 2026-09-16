import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";

const representativeSurfaces = [
  { name: "public", path: "/" },
  { name: "settings", path: "/app/settings/global" },
  { name: "chart", path: "/app/live" },
] as const;

test.describe("UIR-73 through UIR-78 representative certification", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page, { liveFeedState: "connecting" });
    await seedApprovedSession(page);
    await seedChartLayout(page, "single");
  });

  for (const surface of representativeSurfaces) {
    test(`${surface.name} remains semantic and horizontally contained at 200% zoom`, async ({ context, page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Desktop CDP supplies page-scale zoom certification.");
      await gotoStable(page, surface.path, { waitForNetworkIdle: false });
      const client = await context.newCDPSession(page);
      await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
      await expect(page.getByRole("main")).toHaveCount(1);
      await expectNoSeriousViolations(page);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });
  }

  test("public and app skip links provide visible keyboard focus and move focus to main", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Keyboard contract is viewport-independent.");
    await gotoStable(page, "/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await gotoStable(page, "/app/settings/global");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to workspace" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#workspace-content")).toBeFocused();
  });

  test("settings combobox supports arrows, active option, Escape, and long bidirectional text", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Keyboard and bidi behavior are viewport-independent.");
    await page.addInitScript(() => { document.documentElement.dir = "rtl"; document.documentElement.lang = "ar-SA"; });
    await gotoStable(page, "/app/settings/global");
    const search = page.getByRole("combobox", { name: "Search settings" });
    await search.fill("a");
    await expect(search).toHaveAttribute("aria-expanded", "true");
    const initialActive = await search.getAttribute("aria-activedescendant");
    await search.press("ArrowDown");
    await expect.poll(() => search.getAttribute("aria-activedescendant")).not.toBe(initialActive);
    await search.press("Escape");
    await expect(search).toHaveValue("");
    const category = page.getByRole("navigation", { name: "Settings categories" }).getByRole("button").first();
    await category.evaluate((node) => { const label = node.querySelector("span"); if (label) label.textContent = "إعدادات مساحة العمل ذات الاسم الطويل للغاية — Frankfurt Arbeitsbereichseinstellungen"; });
    await expect(category.locator('[dir="auto"]')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("coarse-pointer public, settings, and chart controls meet the 44px target floor", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile project supplies coarse-pointer semantics.");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    for (const surface of representativeSurfaces) {
      await gotoStable(page, surface.path, { waitForNetworkIdle: false });
      const undersized = await page.locator('button:visible, a[href]:visible, input:visible, select:visible, [role="button"]:visible').evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { height: rect.height, label: node.getAttribute("aria-label") || node.textContent?.trim()?.slice(0, 60), width: rect.width };
      }).filter((item) => item.height < 44 || item.width < 44));
      expect(undersized, `${surface.name}: ${JSON.stringify(undersized)}`).toEqual([]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    }
  });

  test("chart feed severity and essential price meaning have textual, live-region alternatives", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Screen-reader contract is viewport-independent.");
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    const status = page.getByRole("status").filter({ hasText: "Connecting live feed" });
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(page.getByText("Connecting", { exact: true }).first()).toBeVisible();
    const chart = page.getByRole("region", { name: /chart/i }).first();
    await expect(chart.locator(".sr-only").first()).toContainText(/Latest bar|No bars are currently available/);
    await expect(chart.getByRole("table", { name: /recent price bars/i })).toHaveCount(1);
  });
});

async function expectNoSeriousViolations(page: Page) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: true } } })).violations.filter((item) => item.impact === "critical" || item.impact === "serious").map((item) => item.id));
  expect(violations).toEqual([]);
}

function horizontalOverflow(page: Page) { return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); }

declare global { interface Window { axe: typeof axe } }
