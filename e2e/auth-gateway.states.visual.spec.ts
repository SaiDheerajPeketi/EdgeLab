import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
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

type ViewportBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

function boxesIntersect(first: ViewportBox, second: ViewportBox) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function expectBoxInsideViewport(
  box: ViewportBox,
  viewport: { height: number; width: number },
  label: string,
) {
  expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectGatewayStateGeometry(page: Page, surface: Locator, label: string) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  const controls = surface.locator(
    ":is(button, a[href], input, select, textarea, [role='button']):visible",
  );
  const [surfaceBox, controlBoxes, overflow] = await Promise.all([
    surface.boundingBox(),
    controls.evaluateAll((elements) => elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
      })
      .filter((box) => box.y + box.height > 0 && box.y < window.innerHeight)),
    page.evaluate(() => ({
      body: document.body.scrollWidth - window.innerWidth,
      document: document.documentElement.scrollWidth - window.innerWidth,
    })),
  ]);

  expect(surfaceBox, `${label} surface box`).not.toBeNull();
  expect(surfaceBox!.x, `${label} left edge`).toBeGreaterThanOrEqual(-1);
  expect(surfaceBox!.x + surfaceBox!.width, `${label} right edge`).toBeLessThanOrEqual(viewport!.width + 1);
  expect(overflow.body, `${label} body overflow`).toBeLessThanOrEqual(1);
  expect(overflow.document, `${label} document overflow`).toBeLessThanOrEqual(1);

  for (const [index, box] of controlBoxes.entries()) {
    expect(box.x, `${label} control ${index + 1} left edge`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${label} control ${index + 1} right edge`).toBeLessThanOrEqual(viewport!.width + 1);
  }

  if (viewport!.width >= 1024) return;
  const mobileNav = page.getByRole("navigation", { name: "Primary workspace" });
  const commands = mobileNav.getByRole("button", { name: "Open command palette" });
  const [navBox, commandBox] = await Promise.all([mobileNav.boundingBox(), commands.boundingBox()]);
  expect(navBox).not.toBeNull();
  expect(commandBox).not.toBeNull();
  expectBoxInsideViewport(navBox!, viewport!, "mobile navigation");
  expectBoxInsideViewport(commandBox!, viewport!, "Commands control");
  const workspaceBottomPadding = await page.locator("#workspace-content").evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).paddingBottom),
  );
  expect(workspaceBottomPadding, `${label} mobile navigation scroll clearance`).toBeGreaterThanOrEqual(navBox!.height);
}

async function expectGatewayErrorGeometry(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 1024) return;

  const surface = page.locator('section[aria-labelledby="session-gateway-unavailable-title"]');
  const mobileNav = page.getByRole("navigation", { name: "Primary workspace" });
  const commands = mobileNav.getByRole("button", { name: "Open command palette" });
  const controls = page.locator(
    "#workspace-content :is(button, a[href], input, select, textarea, [role='button']):visible",
  );

  await expect(surface).toBeVisible();
  await expect(mobileNav).toBeVisible();
  await expect(commands).toBeVisible();

  const [surfaceBox, navBox, commandBox, controlBoxes, overflow] = await Promise.all([
    surface.boundingBox(),
    mobileNav.boundingBox(),
    commands.boundingBox(),
    controls.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      };
    })),
    page.evaluate(() => ({
      body: document.body.scrollWidth - window.innerWidth,
      document: document.documentElement.scrollWidth - window.innerWidth,
    })),
  ]);

  expect(surfaceBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(commandBox).not.toBeNull();
  expect(controlBoxes.length).toBeGreaterThan(0);
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.document).toBeLessThanOrEqual(1);

  expectBoxInsideViewport(surfaceBox!, viewport, "gateway error surface");
  expectBoxInsideViewport(navBox!, viewport, "mobile navigation");
  expectBoxInsideViewport(commandBox!, viewport, "Commands control");
  expect(boxesIntersect(surfaceBox!, navBox!)).toBe(false);
  expect(boxesIntersect(surfaceBox!, commandBox!)).toBe(false);

  for (const [index, controlBox] of controlBoxes.entries()) {
    expectBoxInsideViewport(controlBox, viewport, `workspace control ${index + 1}`);
    expect(boxesIntersect(controlBox, navBox!)).toBe(false);
    expect(boxesIntersect(controlBox, commandBox!)).toBe(false);
  }
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
    await expect(page.getByRole("status", { name: "Loading saved sessions" })).toBeVisible();
    await expect(page.getByText("Checking saved sessions", { exact: true })).toBeVisible();
    await expect(page.getByText("Loading saved sessions…", { exact: true })).toBeVisible();
    await expect(page.getByText("No saved session yet", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Saved sessions will appear here", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create your first session" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New session" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use sample setup" })).toHaveCount(0);
    await expect(page.getByText("1 markets ready", { exact: true })).toBeVisible();
    const builder = page.locator("#new-session");
    await expect(builder.getByRole("status", { name: "Loading strategies" })).toBeVisible();
    await expect(builder.getByText("No saved strategies", { exact: true })).toHaveCount(0);
    await expect(builder.getByRole("combobox", { name: "Existing strategy" })).toBeDisabled();
    await expect(builder.getByRole("button", { name: "New", exact: true })).toBeDisabled();
    await expect(builder.locator('input[name="strategy-name"]')).toBeDisabled();
    await expect(builder.locator('button[type="submit"]')).toBeDisabled();
    await expectGatewayStateGeometry(page, page.locator(".session-gateway"), "gateway loading");
    await expectStableScreenshot(page, "gateway-loading", { fullPage: false });
  });

  test("gateway sample-data setup baseline", async ({ page }) => {
    await page.route(/\/api\/bootstrap-shell(?:\?|$)/, (route) => fulfillJson(route, emptyShell));
    await gotoStable(page, "/app", { waitForNetworkIdle: false });

    await page.getByRole("button", { name: "Use sample setup" }).click();
    const builder = page.locator("#new-session");
    const strategyName = page.locator('input[name="strategy-name"]');
    await expect(strategyName).toHaveValue("Sample replay review");
    await expect(page.getByRole("combobox", { name: "Instrument" })).toHaveValue(/BTCUSDT/);
    await expect(page.getByRole("button", { name: "5m", exact: true })).toHaveClass(/timeframe-button-active/);
    await builder.evaluate((element) => element.scrollIntoView({ behavior: "auto", block: "start" }));
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(builder).toBeInViewport();
    await expectGatewayStateGeometry(page, builder, "gateway sample-data setup");
    await expectStableScreenshot(page, "gateway-sample-data", { fullPage: false });
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
    await expectGatewayErrorGeometry(page);
    await expect(page).toHaveScreenshot("gateway-error.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.001,
      threshold: 0.1,
    });

    recoveryAvailable = true;
    await retry.click();
    await expect(page.getByRole("button", { name: "Retrying saved sessions…" })).toBeDisabled();
    await expect(page.getByRole("heading", { level: 1, name: "Saved sessions unavailable" })).toHaveCount(0);
    await expect(page.getByText("No saved session yet", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create your first session" })).toBeEnabled();
  });
});
