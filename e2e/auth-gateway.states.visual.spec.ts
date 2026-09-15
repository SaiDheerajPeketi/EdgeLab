import { expect, test, type Page, type Route } from "@playwright/test";
import {
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
  seedGoogleCallback,
  settlePage,
} from "./support/app";

const emptyShell = {
  active_session_id: null,
  dashboard_summary: null,
  playbooks: [],
  recent_session_limit: 25,
  recent_sessions: [],
  recent_sessions_has_more: false,
  recent_sessions_next_cursor: null,
  recent_sessions_next_offset: 0,
  strategy_summaries: [],
} as const;

const emptyTradePage = {
  has_more: false,
  items: [],
  next_cursor: null,
  next_offset: 0,
} as const;

function fulfillJson(route: Route, value: unknown, status = 200) {
  return route.fulfill({
    body: JSON.stringify(value),
    contentType: "application/json",
    status,
  });
}

async function holdCallbackHandoffFrame(page: Page) {
  await page.route("**/api/auth/google/exchange", async (route) => {
    await page.evaluate(() => {
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
      const heldFrameId = 2_147_483_647;
      let held = false;

      window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        if (!held) {
          held = true;
          return heldFrameId;
        }
        return nativeRequestAnimationFrame(callback);
      };
      window.cancelAnimationFrame = (frameId: number) => {
        if (frameId !== heldFrameId) nativeCancelAnimationFrame(frameId);
      };
    });
    await route.fallback();
  });
}

test.describe("authentication capacity and callback handoffs", () => {
  test("beta capacity baseline", async ({ page }) => {
    await installDeterminism(page, { seatsRemaining: 0 });
    await gotoStable(page, "/auth/signin");

    await expect(page.getByRole("heading", { level: 1, name: "Reserve your beta place." })).toBeVisible();
    await expect(page.getByText("Waitlist open", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join waitlist with Google" })).toBeVisible();
    await expectStableScreenshot(page, "auth-capacity", { fullPage: false });
  });

  test("callback success handoff baseline", async ({ page }) => {
    await installDeterminism(page);
    await seedGoogleCallback(page, "/app/reports");
    await holdCallbackHandoffFrame(page);

    await page.goto(
      "/auth/callback/google?code=visual-code&state=visual-oauth-state",
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { level: 1, name: "Access confirmed." })).toBeVisible();
    await expect(page.getByRole("status", { name: "Opening workspace" })).toBeVisible();
    await settlePage(page, { waitForNetworkIdle: false });
    await expectStableScreenshot(page, "auth-callback-success", { fullPage: false });
  });

  test("callback failure handoff baseline", async ({ page }) => {
    await installDeterminism(page);
    await seedGoogleCallback(page, "/app/reports");
    await page.route("**/api/auth/google/exchange", (route) => fulfillJson(
      route,
      { detail: "The secure session exchange was rejected." },
      503,
    ));

    await page.goto(
      "/auth/callback/google?code=visual-code&state=visual-oauth-state",
      { waitUntil: "domcontentloaded" },
    );
    await expect(page).toHaveURL(/\/auth\/signin\?.*from=%2Fapp%2Freports/);
    await expect(page.getByRole("heading", { level: 1, name: "We could not finish signing in." })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("safely try the sign-in again");
    await settlePage(page, { waitForNetworkIdle: false });
    await expectStableScreenshot(page, "auth-callback-failure", { fullPage: false });
  });

  test("callback success restores the requested route", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The route handoff contract is viewport-independent.");
    await installDeterminism(page);
    await seedGoogleCallback(page, "/app/reports");

    await page.goto(
      "/auth/callback/google?code=visual-code&state=visual-oauth-state",
      { waitUntil: "domcontentloaded" },
    );
    await expect(page).toHaveURL(/\/app\/reports$/);
    await expect(page.locator("#workspace-content")).toBeVisible();
  });
});

test.describe("session gateway critical states", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("gateway empty baseline", async ({ page }) => {
    await page.route(/\/api\/bootstrap-shell(?:\?|$)/, (route) => fulfillJson(route, emptyShell));
    await gotoStable(page, "/app", { waitForNetworkIdle: false });

    await expect(page.getByRole("heading", { level: 1, name: "Continue where the market left you." })).toBeVisible();
    await expect(page.getByText("No saved session yet", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create your first session" })).toBeEnabled();
    await expect(page.getByText("1 markets ready", { exact: true })).toBeVisible();
    await expectStableScreenshot(page, "gateway-empty", { fullPage: false });
  });

  test("gateway loading contract", async ({ page }) => {
    await page.route(/\/api\/bootstrap-shell(?:\?|$)/, () => new Promise(() => undefined));
    await gotoStable(page, "/app", { waitForNetworkIdle: false });

    await expect(page.getByRole("heading", { level: 1, name: "Continue where the market left you." })).toBeVisible();
    await expect(page.getByRole("status", { name: "Opening session" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Create your first session/ })).toBeDisabled();
    await expect(page.getByText("1 markets ready", { exact: true })).toBeVisible();
  });

  test("gateway error baseline", async ({ page }) => {
    let recoveryAvailable = false;
    const unavailable = (route: Route) => fulfillJson(
      route,
      { detail: "Saved sessions request failed." },
      503,
    );
    await page.route(/\/api\/bootstrap-shell(?:\?|$)/, async (route) => {
      if (!recoveryAvailable) return unavailable(route);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return fulfillJson(route, emptyShell);
    });
    await page.route(/\/api\/bootstrap(?:\?|$)/, unavailable);
    await page.route(/\/api\/backtests(?:\?|$)/, unavailable);
    await page.route(/\/api\/trades\/page(?:\?|$)/, (route) => fulfillJson(route, emptyTradePage));
    await gotoStable(page, "/app", { waitForNetworkIdle: false });

    await expect(page.getByRole("heading", { level: 1, name: "Saved sessions unavailable" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("session service did not respond");
    await expect(page.getByText("No saved session yet", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create your first session" })).toHaveCount(0);
    const retry = page.getByRole("button", { name: "Retry saved sessions" });
    await expect(retry).toBeEnabled();
    await expectStableScreenshot(page, "gateway-error", { fullPage: false });

    recoveryAvailable = true;
    await retry.click();
    await expect(page.getByRole("button", { name: "Retrying saved sessions…" })).toBeDisabled();
    await expect(page.getByRole("heading", { level: 1, name: "Saved sessions unavailable" })).toHaveCount(0);
    await expect(page.getByText("No saved session yet", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create your first session" })).toBeEnabled();
  });
});
