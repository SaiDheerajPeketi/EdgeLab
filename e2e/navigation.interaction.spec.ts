import { expect, test } from "@playwright/test";
import {
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
  settlePage,
} from "./support/app";

test("marketing anchors and disclosure controls remain operable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Covered once at desktop size.");
  await installDeterminism(page);
  await gotoStable(page, "/");

  await page.getByRole("link", { name: "See the workflow" }).click();
  await expect(page).toHaveURL(/\/#how-it-works$/);
  await expect(page.getByRole("heading", { name: "One continuous loop." })).toBeInViewport();

  await page.goto("/#faq");
  await settlePage(page);
  const question = page.getByRole("button", { name: "What happens during beta?" });
  await question.click();
  await expect(question).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "What happens during beta?" })).toBeVisible();
});

test("mobile navigation owns focus and Escape restores the trigger", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile menu is hidden at wider breakpoints.");
  await installDeterminism(page);
  await gotoStable(page, "/");

  const trigger = page.getByRole("button", { name: "Open navigation menu" });
  await trigger.click();
  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(menu).toBeVisible();
  await expect(menu.locator("a").first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("keyboard skip link reaches main content", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Keyboard focus contract is viewport-independent.");
  await installDeterminism(page);
  await gotoStable(page, "/");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator("#main-content")).toBeFocused();
});

test("auth recovery preserves a safe return and masks protected content", async ({ page }) => {
  await installDeterminism(page, { devAuth: true });
  await gotoStable(page, "/app/reports?range=30d");
  await expect(page).toHaveURL(/\/auth\/signin\?.*from=%2Fapp%2Freports/);

  await page.getByRole("button", { name: "Local development sign-in" }).click();
  await expect(page).toHaveURL(/\/app\/reports\?range=30d$/);
  const protectedContent = page.locator("#workspace-content");
  await expect(protectedContent).toBeVisible();
  await settlePage(page);
  await expectStableScreenshot(page, "protected-shell-masked", {
    fullPage: false,
    mask: [protectedContent, page.locator('[role="status"]')],
  });
});

test("unsafe auth return is reduced to the workspace root", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Safe-return logic is viewport-independent.");
  await installDeterminism(page, { devAuth: true });
  await gotoStable(page, "/auth/signin?from=https%3A%2F%2Fevil.example%2Fsteal");

  await page.getByRole("button", { name: "Local development sign-in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(new URL(page.url()).origin).toBe("http://127.0.0.1:45173");
});

test("reduced motion removes transitions without hiding content", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Reduced-motion CSS is viewport-independent.");
  await installDeterminism(page);
  await gotoStable(page, "/");

  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const motionState = await page.locator("[data-motion]").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
  });
  expect(motionState).toEqual({ animationDuration: "0s", transitionDuration: "0s" });
  await expect(page.getByRole("heading", { name: "Replay the market. Preserve the decision." })).toBeVisible();
});

test("an already authenticated protected shell remains reachable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Direct protected-shell restoration is viewport-independent.");
  await installDeterminism(page);
  await seedApprovedSession(page);
  await gotoStable(page, "/app");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("#workspace-content")).toBeVisible();
});
