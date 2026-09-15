import { expect, test } from "@playwright/test";
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
});
