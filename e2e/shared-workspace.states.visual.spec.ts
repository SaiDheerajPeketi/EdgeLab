import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
} from "./support/app";

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

async function expectStateGeometry(page: Page, surface: Locator, label: string) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  const [surfaceBox, controlBoxes, overflow] = await Promise.all([
    surface.boundingBox(),
    surface.locator(":is(button, a[href]):visible").evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    })),
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
    expect(box.left, `${label} control ${index + 1} left edge`).toBeGreaterThanOrEqual(-1);
    expect(box.right, `${label} control ${index + 1} right edge`).toBeLessThanOrEqual(viewport!.width + 1);
  }
}

test.describe("shared workspace access-state visual baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("revoked snapshot baseline", async ({ page }) => {
    await page.route("**/api/workspace-shares/open", (route) => route.fulfill({
      body: JSON.stringify({ detail: "revoked" }),
      contentType: "application/json",
      status: 410,
    }));

    await gotoStable(page, "/shared#revoked-share", { waitForNetworkIdle: false });
    await expect(page.getByRole("heading", { name: "Snapshot unavailable" })).toBeVisible();
    await expect(page.getByText("This workspace link has expired or was revoked. Ask the owner for a new snapshot.")).toBeVisible();
    await expectStableScreenshot(page, "shared-revoked", { fullPage: false });
  });

  test("forbidden snapshot baseline", async ({ page }) => {
    await page.route("**/api/workspace-shares/open", (route) => route.fulfill({
      body: JSON.stringify({ detail: "forbidden" }),
      contentType: "application/json",
      status: 403,
    }));

    await gotoStable(page, "/shared#forbidden-share", { waitForNetworkIdle: false });
    await expect(page.getByRole("heading", { name: "Snapshot unavailable" })).toBeVisible();
    await expect(page.getByText("This snapshot is unavailable to your EdgeLab account. Check the link or ask the owner to share it with your sign-in email.")).toBeVisible();
    await expectStableScreenshot(page, "shared-forbidden", { fullPage: false });
  });

  test("expired session preserves a safe sign-in return", async ({ page }) => {
    await page.route("**/api/workspace-shares/open", (route) => route.fulfill({ body: JSON.stringify({ detail: "expired" }), contentType: "application/json", status: 401 }));
    await gotoStable(page, "/shared#abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN", { waitForNetworkIdle: false });
    await expect(page.getByRole("alert")).toContainText("session expired");
    const signIn = page.getByRole("link", { name: "Sign in again" });
    await expect(signIn).toHaveAttribute("href", "/auth/signin?reason=expired");
    await page.evaluate(() => window.localStorage.clear());
    await signIn.click();
    await expect(page).toHaveURL(/\/auth\/signin\?reason=expired$/);
    await expect.poll(() => page.evaluate(() => window.history.state?.usr?.fromPath)).toBe("/shared#abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN");
    await expect(page.getByRole("heading", { name: "Your sign-in expired." })).toBeVisible();
  });

  for (const status of [403, 404]) {
    test(`${status} remains a non-retryable access denial`, async ({ page }) => {
      await page.route("**/api/workspace-shares/open", (route) => route.fulfill({ body: JSON.stringify({ detail: "denied" }), contentType: "application/json", status }));
      await gotoStable(page, `/shared#access-denied-${status}`, { waitForNetworkIdle: false });
      await expect(page.getByRole("alert")).toContainText("unavailable to your EdgeLab account");
      await expect(page.getByRole("button", { name: "Try opening again" })).toHaveCount(0);
    });
  }

  test("rate limiting gives accurate retry guidance", async ({ page }) => {
    await page.route("**/api/workspace-shares/open", (route) => route.fulfill({ body: JSON.stringify({ detail: "rate limited" }), contentType: "application/json", status: 429 }));
    await gotoStable(page, "/shared#rate-limited", { waitForNetworkIdle: false });
    await expect(page.getByRole("alert")).toContainText("Too many snapshot requests");
    await expect(page.getByRole("button", { name: "Try opening again" })).toBeEnabled();
  });

  test("network failure names the connection boundary", async ({ page }) => {
    await page.route("**/api/workspace-shares/open", (route) => route.abort("failed"));
    await gotoStable(page, "/shared#network-failure", { waitForNetworkIdle: false });
    await expect(page.getByRole("alert")).toContainText("could not reach the sharing service");
    await expect(page.getByRole("button", { name: "Try opening again" })).toBeEnabled();
  });

  test("open as copy recovery baseline", async ({ page }) => {
    await page.route("**/api/workspace-shares/open", (route) => route.fulfill({
      body: JSON.stringify(sharedSnapshot),
      contentType: "application/json",
      status: 200,
    }));
    await gotoStable(page, "/shared#copy-share", { waitForNetworkIdle: false });
    await page.getByRole("button", { name: "Open as copy" }).click();
    await expect(page.getByRole("alert")).toContainText("The copy could not be saved on this device or to your account.");
    await expect(page.getByRole("button", { name: "Retry copy" })).toBeVisible();
    await expectStableScreenshot(page, "shared-open-as-copy-error", { fullPage: false });
  });

  test("transport error baseline and retry recovery", async ({ page }) => {
    let serviceAvailable = false;
    await page.route("**/api/workspace-shares/open", (route) => route.fulfill({
      body: JSON.stringify(serviceAvailable ? sharedSnapshot : { detail: "sharing service unavailable" }),
      contentType: "application/json",
      status: serviceAvailable ? 200 : 503,
    }));

    await gotoStable(page, "/shared#transport-error-share", { waitForNetworkIdle: false });
    const errorSurface = page.locator('section[aria-labelledby="shared-snapshot-error-title"]');
    await expect(page.getByRole("heading", { name: "Snapshot unavailable" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText(
      "The sharing service is temporarily unavailable, so this snapshot could not be opened. Try again shortly.",
    );
    await expect(page.getByText("This snapshot is unavailable to your EdgeLab account.", { exact: false })).toHaveCount(0);
    const retry = page.getByRole("button", { name: "Try opening again" });
    await expect(retry).toBeEnabled();
    await expectStateGeometry(page, errorSurface, "shared transport error");
    await expectStableScreenshot(page, "shared-transport-error", { fullPage: false });

    serviceAvailable = true;
    await retry.click();
    await expect(page.getByRole("heading", { name: "Opening range review" })).toBeVisible();
    await expect(errorSurface).toHaveCount(0);
  });
});
