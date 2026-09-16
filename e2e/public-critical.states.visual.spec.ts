import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
} from "./support/app";

const openBetaProgram = {
  mode: "beta",
  seats_remaining: 363,
  seats_taken: 137,
  seats_total: 500,
  waitlist_count: 27,
};

const fullBetaProgram = {
  ...openBetaProgram,
  seats_remaining: 0,
  seats_taken: 500,
  waitlist_count: 84,
};

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport + 1);
}

async function revealProductionAccessColumn(page: Page) {
  const comparison = page.getByLabel("Scrollable access comparison");
  if (!(await comparison.isVisible())) return;
  await comparison.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
}

async function positionPricingBoundary(page: Page, boundary: Locator) {
  await boundary.evaluate((element) => {
    const targetTop = element.getBoundingClientRect().top + window.scrollY - 180;
    window.scrollTo(0, Math.max(0, targetTop));
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test.describe("landing critical-state visual baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
  });

  test("CTA availability pending baseline", async ({ page }) => {
    await page.route("**/api/auth/beta/status", () => new Promise(() => undefined));
    await gotoStable(page, "/", { waitForNetworkIdle: false });
    await expect(page.getByText("checking availability", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Join beta" }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectStableScreenshot(page, "landing-cta-pending", { fullPage: false });
  });

  test("CTA availability success baseline", async ({ page }) => {
    await page.route("**/api/auth/beta/status", (route) => route.fulfill({
      body: JSON.stringify(openBetaProgram),
      contentType: "application/json",
      status: 200,
    }));
    await gotoStable(page, "/", { waitForNetworkIdle: false });
    await expect(page.getByText("363 open now", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Join beta" }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectStableScreenshot(page, "landing-cta-success", { fullPage: false });
  });

  test("CTA availability error fallback baseline", async ({ page }) => {
    await page.route("**/api/auth/beta/status", (route) => route.abort("failed"));
    await gotoStable(page, "/", { waitForNetworkIdle: false });
    await expect(page.getByText("availability unavailable", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Join beta" }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectStableScreenshot(page, "landing-cta-error-fallback", { fullPage: false });
  });

  test("beta capacity routes the primary CTA to the waitlist", async ({ page }) => {
    await page.route("**/api/auth/beta/status", (route) => route.fulfill({ body: JSON.stringify(fullBetaProgram), contentType: "application/json", status: 200 }));
    await gotoStable(page, "/", { waitForNetworkIdle: false });
    await expect(page.getByText("waitlist live", { exact: true })).toBeVisible();
    await expect(page.getByText("Waitlist open", { exact: true })).toBeVisible();
    const cta = page.getByRole("link", { name: "Join waitlist" }).first();
    await expect(cta).toHaveAttribute("href", /waitlist=1/);
    await expectInteractiveGeometry(page, cta);
    await expectNoHorizontalOverflow(page);
    await expectStableScreenshot(page, "landing-beta-full", { fullPage: false });
  });

  test("landing journey exposes a recoverable sign-in failure", async ({ page }) => {
    await page.route("**/api/auth/config", (route) => route.fulfill({
      body: JSON.stringify({ dev_auth_bypass_enabled: true, google_client_id: "visual-client.apps.googleusercontent.com", google_enabled: true, google_redirect_uri: "http://127.0.0.1/auth/callback/google", manual_access_enabled: false }),
      contentType: "application/json",
      status: 200,
    }));
    await page.route("**/api/auth/dev/bypass", (route) => route.fulfill({ body: JSON.stringify({ detail: "fixture submission failure" }), contentType: "application/json", status: 503 }));
    await gotoStable(page, "/", { waitForNetworkIdle: false });
    await page.getByRole("link", { name: "Join beta" }).first().click();
    await expect(page).toHaveURL(/\/auth\/signin/);
    const submit = page.getByRole("button", { name: "Local development sign-in" });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole("alert").filter({ hasText: "Local development sign-in is unavailable for this origin." })).toBeVisible();
    await expect(submit).toBeEnabled();
    await expectInteractiveGeometry(page, submit);
    await expectNoHorizontalOverflow(page);
    await expectStableScreenshot(page, "auth-signin-dev-bypass-error", { fullPage: false });
  });

  test("mobile navigation menu baseline", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "The compact navigation menu is mobile-only.");
    await gotoStable(page, "/", { waitForNetworkIdle: false });
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    const menu = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("link", { name: "Join beta" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectStableScreenshot(page, "landing-mobile-menu", { fullPage: false });
  });
});

async function expectInteractiveGeometry(page: Page, control: Locator) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual((await page.viewportSize())!.width);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

test.describe("pricing disclosure visual baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
  });

  test("annual billing remains explicitly unconfirmed", async ({ page }, testInfo) => {
    await gotoStable(page, "/pricing", { waitForNetworkIdle: false });
    const annualBoundary = page.locator(testInfo.project.name === "mobile" ? "[data-access-comparison-mobile] dd" : "td:visible").filter({ hasText: /Monthly and annual options not confirmed/ });
    await revealProductionAccessColumn(page);
    await positionPricingBoundary(page, annualBoundary);
    await expect(annualBoundary).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    await expectStableScreenshot(page, "pricing-annual-unconfirmed", { fullPage: false });
  });

  test("provider-limited pricing boundary", async ({ page }, testInfo) => {
    await gotoStable(page, "/pricing", { waitForNetworkIdle: false });
    const providerBoundary = page.locator(testInfo.project.name === "mobile" ? "[data-access-comparison-mobile] dd" : "td:visible").filter({ hasText: /Provider entitlements not announced/ });
    await revealProductionAccessColumn(page);
    await positionPricingBoundary(page, providerBoundary);
    await expect(providerBoundary).toBeInViewport();
    await expectNoHorizontalOverflow(page);
    await expectStableScreenshot(page, "pricing-provider-limited", { fullPage: false });
  });

  test("expanded provider FAQ baseline", async ({ page }) => {
    await gotoStable(page, "/pricing#faq", { waitForNetworkIdle: false });
    const question = page.getByRole("button", { name: "Does EdgeLab connect to my broker or data provider?" });
    await question.scrollIntoViewIfNeeded();
    await question.click();
    await expect(question).toHaveAttribute("aria-expanded", "true");
    const answer = page.getByRole("region", { name: "Does EdgeLab connect to my broker or data provider?" });
    await expect(answer).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectStableScreenshot(page, "pricing-faq-provider-expanded", { fullPage: false });
  });
});
