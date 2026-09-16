import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectStableScreenshot, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

test.describe("navigation and productivity overlay evidence", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("command palette and shortcut catalog are keyboard operable and contained", async ({ page }) => {
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    const trigger = page.getByRole("button", { name: "Open command palette" }).first();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "EdgeLab command palette" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox")).toBeFocused();
    await expectContained(page, dialog);
    await expectStableScreenshot(page, "overlay-command-palette", { fullPage: false });

    await dialog.getByRole("combobox").fill("Keyboard shortcut reference");
    await page.keyboard.press("Enter");
    await expect(dialog.getByText("Keyboard shortcuts", { exact: true })).toBeVisible();
    await expectContained(page, dialog);
    await expectStableScreenshot(page, "overlay-shortcut-catalog", { fullPage: false });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("account menu is focusable, dismissible, and viewport-contained", async ({ page }, testInfo) => {
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    if (testInfo.project.name !== "desktop") {
      const more = page.getByRole("button", { name: "More", exact: true });
      await more.click();
      const drawer = page.getByRole("dialog", { name: "More workspace tools" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText("Visual Reviewer", { exact: true })).toBeVisible();
      await expectContained(page, drawer);
      await expectStableScreenshot(page, "overlay-account-menu", { fullPage: false });
      await page.keyboard.press("Escape");
      await expect(more).toBeFocused();
      return;
    }

    const trigger = page.getByRole("button", { name: "Open account menu for Visual Reviewer" });
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Visual Reviewer" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "Workspace settings" })).toBeFocused();
    await expectContained(page, menu);
    await expectStableScreenshot(page, "overlay-account-menu", { fullPage: false });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("mobile navigation owns focus and remains above the fixed navigation", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The authenticated navigation drawer is mobile-only.");
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    const trigger = page.getByRole("button", { name: "More", exact: true });
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "More workspace tools" });
    await expect(drawer.getByRole("button", { name: "Close more tools" })).toBeFocused();
    await expectContained(page, drawer);
    await expectStableScreenshot(page, "overlay-mobile-navigation", { fullPage: false });
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });

  test("trade review drawer is actionable and dismissible without overflow", async ({ page }) => {
    await gotoStable(page, "/app/journal/trades", { waitForNetworkIdle: false });
    const trigger = page.getByRole("table", { name: "Journal trades" }).getByRole("button", { name: "BTCUSDT", exact: true }).first();
    await trigger.click({ force: true });
    const drawer = page.getByRole("dialog", { name: "Review BTCUSDT" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Review BTCUSDT" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: /Close review/ })).toBeFocused();
    await expectContained(page, drawer);
    await expectStableScreenshot(page, "overlay-trade-review-drawer", { fullPage: false });
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

async function expectContained(page: Page, surface: Locator) {
  const viewport = page.viewportSize()!;
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(await surface.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}
