import { expect, test } from "@playwright/test";
import {
  certifyUiState,
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  settlePage,
  seedGoogleCallback,
} from "./support/app";

const publicSurfaces = [
  { fullPage: true, heading: "Replay the market. Preserve the decision.", level: 1, name: "landing", path: "/" },
  { fullPage: true, heading: "Current access, without fine print.", level: 1, name: "pricing", path: "/pricing" },
  { fullPage: true, heading: "Privacy Policy", level: 1, name: "privacy", path: "/privacy" },
  { fullPage: true, heading: "Terms of Use", level: 1, name: "terms", path: "/terms" },
  { fullPage: true, heading: "Continue to EdgeLab.", level: 1, name: "signin", path: "/auth/signin" },
  { fullPage: true, heading: "Reserve your beta place.", level: 1, name: "waitlist", path: "/auth/signin?waitlist=1" },
  { fullPage: true, heading: "Page not found", level: 1, name: "not-found", path: "/missing-ui-regression-route" },
] as const;

const authErrors = [
  { name: "expired", query: "reason=oauth-state-expired", title: "Your sign-in expired." },
  { name: "cancelled", query: "error=access_denied", title: "Sign-in was cancelled." },
  { name: "denied", query: "reason=access-denied", title: "Beta access is not available for this account." },
  { name: "retryable", query: "error=exchange_failed", title: "We could not finish signing in." },
] as const;

test.describe("public and authentication visual baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await page.route("**/api/billing/catalog", (route) => route.fulfill({
      json: {
        provider: "stripe",
        enabled: false,
        mode: "live",
        checkout_available: false,
        reason: "Stripe is not configured",
        plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
      },
    }));
  });

  for (const surface of publicSurfaces) {
    test(`${surface.name} surface`, async ({ page }) => {
      await gotoStable(page, surface.path);
      await expect(page.getByRole("heading", { level: surface.level, name: surface.heading })).toBeVisible();
      if (surface.name === "landing") {
        await expect(page.getByRole("link", { name: "Join beta" }).first()).toBeVisible();
        await page.locator("#pricing").scrollIntoViewIfNeeded();
        await expect(page.getByRole("progressbar", { name: "Beta seat capacity" })).toBeVisible();
        await expect(page.getByText("Test the core workflow free.", { exact: true })).toBeVisible();
        await certifyUiState(page);
      } else if (surface.name === "pricing") {
        await expect(page.getByText("Test the core workflow free.", { exact: true })).toBeVisible();
        await expect(page.locator("dd:visible, td:visible").filter({ hasText: "Free workspace for approved beta users" }).first()).toBeVisible();
        await expect(page.locator("dd:visible, td:visible").filter({ hasText: "Active paid subscription required" }).first()).toBeVisible();
        const pro = page.getByTestId("pro-pricing");
        await expect(pro.getByText("$29", { exact: true })).toBeVisible();
        await expect(pro.getByRole("radio", { name: "Monthly" })).toBeChecked();
        await expect(pro.getByText(/Paid checkout is not available yet/)).toBeVisible();
        await expectStableScreenshot(page, "beta-pricing-pro-exports48", { fullPage: true });
      } else if (surface.name === "privacy" || surface.name === "terms") {
        await expect(page.getByText(/Stripe/).first()).toBeVisible();
        await expect(page.getByText(/active paid subscription/i).first()).toBeVisible();
        await certifyUiState(page);
      } else {
        await expectStableScreenshot(page, surface.name, { fullPage: surface.fullPage });
      }
    });
  }

  for (const error of authErrors) {
    test(`authentication error: ${error.name}`, async ({ page }) => {
      await gotoStable(page, `/auth/signin?${error.query}&from=%2Fapp%2Freports`);
      await expect(page.getByRole("heading", { level: 1, name: error.title })).toBeVisible();
      await expectStableScreenshot(page, `auth-error-${error.name}`);
    });
  }

  test("callback transition", async ({ page }) => {
    await seedGoogleCallback(page, "/app/reports");
    let exchangeStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { exchangeStarted = resolve; });
    await page.route("**/api/auth/google/exchange", async () => {
      exchangeStarted?.();
      await new Promise(() => undefined);
    });

    const navigation = page.goto(
      "/auth/callback/google?code=visual-code&state=visual-oauth-state",
      { waitUntil: "domcontentloaded" },
    );
    await Promise.all([navigation, started]);
    await expect(page.getByRole("heading", { level: 1, name: "Restoring your EdgeLab session." })).toBeVisible();
    await settlePage(page, { waitForNetworkIdle: false });
    await expectStableScreenshot(page, "auth-callback", { fullPage: false });
  });
});

test("development sign-in restores the requested authenticated route", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Authentication routing is viewport-independent.");
  await installDeterminism(page, { devAuth: true });
  await gotoStable(page, "/auth/signin?from=%2Fapp%2Freports");
  await page.getByRole("button", { name: "Local development sign-in" }).click();
  await expect(page).toHaveURL(/\/app\/reports$/);
  await expect(page.locator("#workspace-content")).toBeVisible();
});
