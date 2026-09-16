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
      await page.setViewportSize({ width: 720, height: 500 });
      await expect(page.getByRole("main")).toHaveCount(1);
      await expectNoSeriousViolations(page);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
      const keyControl = surface.name === "public" ? page.getByRole("button", { name: "Open navigation menu" }) : surface.name === "settings" ? page.getByRole("combobox", { name: "Search settings" }) : page.getByRole("button", { name: "Tools", exact: true });
      await keyControl.scrollIntoViewIfNeeded();
      await expect(keyControl).toBeVisible();
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
    await installDocumentLocale(page, "ar-SA", "rtl");
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
      if (surface.name === "public") await page.getByRole("button", { name: "Open navigation menu" }).click();
      if (surface.name === "settings") await page.getByRole("combobox", { name: "Search settings" }).fill("risk");
      if (surface.name === "chart") await page.getByRole("button", { name: "Tools", exact: true }).click();
      const undersized = await undersizedTargets(page);
      expect(undersized, `${surface.name}: ${JSON.stringify(undersized)}`).toEqual([]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    }
  });

  test("journal trade table renders real long RTL content with locale-aware date, quantity, and JPY currency", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Locale/content stress is audited once.");
    await installDocumentLocale(page, "ar-SA", "rtl");
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/journal/accounts") return route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: 501, broker_account_id: null, source_type: "MANUAL", source_key: "rtl-account", name: "حساب العقود الآجلة طويل الاسم — مكتب فرانكفورت", provider: "يدوي", currency: "JPY", timezone: "Asia/Tokyo", initial_balance: "999999999.99", color: "#22d3ee", notes: "", status: "ACTIVE", created_at: "2026-09-15T10:00:00Z", updated_at: "2026-09-15T10:00:00Z" }]) });
      if (path === "/api/journal/trades") return route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: 601, account_id: 501, import_run_id: null, source_type: "MANUAL", source_ref: "rtl-trade", duplicate_key: "rtl-trade", entry_type: "TAKEN", status: "CLOSED", symbol: "NK225", source_symbol: "NK225", currency: "JPY", source_timezone: "Asia/Tokyo", side: "LONG", entry_time: "2026-09-15T09:05:00Z", exit_time: "2026-09-15T09:42:00Z", entry_price: "42001.25", exit_price: "42150.50", quantity: "1234567.89", remaining_quantity: "0", gross_pnl: "987654321.12", net_pnl: "987654300.12", commission: "10", fees: "11", stop_loss: null, take_profit: null, planned_entry_price: null, planned_exit_price: null, planned_stop_loss: null, planned_take_profit: null, r_multiple: "1234.56", strategy_name: "استراتيجية افتتاح السوق ذات الاسم الطويل للغاية — Langfristige Eröffnungsstrategie", emotional_state: null, missed_reason: null, rating: 5, setup_grade: "A", reviewed: true, reviewed_at: "2026-09-15T10:00:00Z", created_at: "2026-09-15T10:00:00Z", updated_at: "2026-09-15T10:00:00Z", tags: [], notes: [{ id: 701, kind: "REVIEW", body: "ملاحظة مستخدم طويلة", created_at: "2026-09-15T10:00:00Z" }], screenshots: [], executions: [] }]) });
      return route.fallback();
    });
    await gotoStable(page, "/app/journal/trades");
    const table = page.getByRole("table", { name: "Journal trades" });
    const expected = await page.evaluate(() => ({
      currency: new Intl.NumberFormat("ar-SA", { style: "currency", currency: "JPY", maximumFractionDigits: 2 }).format(987654300.12),
      date: new Intl.DateTimeFormat("ar-SA").format(new Date("2026-09-15T09:05:00Z")),
      quantity: new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 8 }).format(1234567.89),
    }));
    await expect(table.getByText(/استراتيجية افتتاح السوق/)).toBeVisible();
    await expect(table).toContainText(expected.currency);
    await expect(table).toContainText(expected.date);
    await expect(table).toContainText(expected.quantity);
    await expect(table.locator('[dir="auto"]')).toHaveCount(2);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
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
function undersizedTargets(page: Page) { return page.locator('button:visible, a[href]:visible, input:visible, select:visible, [role="button"]:visible, [role="option"]:visible').evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { height: rect.height, label: node.getAttribute("aria-label") || node.textContent?.trim()?.slice(0, 60), width: rect.width }; }).filter((item) => item.height < 44 || item.width < 44)); }
function installDocumentLocale(page: Page, locale: string, direction: "ltr" | "rtl") {
  return page.addInitScript(({ locale, direction }) => {
    const apply = () => {
      if (!document.documentElement) return;
      document.documentElement.lang = locale;
      if (direction === "rtl") document.documentElement.dir = "rtl";
      else document.documentElement.dir = "ltr";
    };
    new MutationObserver(apply).observe(document, { childList: true, subtree: true });
    apply();
  }, { locale, direction });
}

declare global { interface Window { axe: typeof axe } }
