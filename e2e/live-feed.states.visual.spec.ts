import { expect, test } from "@playwright/test";
import {
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
  seedChartLayout,
} from "./support/app";

const states = [
  { fixture: "connecting", state: "loading", title: "Connecting live feed" },
  { fixture: "delayed", state: "partial", title: "Market data is delayed" },
  { fixture: "stale", state: "stale", title: "Market data is stale" },
  { fixture: "offline", state: "offline", title: "Live feed offline" },
  { fixture: "unsupported", state: "unsupported", title: "Instrument not supported" },
] as const;

test.describe("live feed health states", () => {
  for (const state of states) {
    test(`${state.fixture} keeps chart context and names the safe next step`, async ({ page }) => {
      await installDeterminism(page, { liveFeedState: state.fixture });
      await seedApprovedSession(page);
      await seedChartLayout(page, "single");
      await gotoStable(page, "/app/live", { waitForNetworkIdle: false });

      const health = page.locator(`[data-state="${state.state}"]`).filter({ hasText: state.title });
      await expect(health).toBeVisible();
      await expect(page.getByRole("region", { name: /BTC.*chart/i }).first()).toBeVisible();
      if (state.fixture === "connecting") {
        await expect(health.getByRole("button")).toHaveCount(0);
      } else {
        const actionName = state.fixture === "unsupported" ? "Choose provider" : state.fixture === "stale" || state.fixture === "delayed" ? "Reconnect" : "Try again";
        await expect(health.getByRole("button", { name: actionName })).toBeVisible();
      }
      const expectedStatus = state.fixture === "stale" ? "Feed stale" : state.fixture === "delayed" ? "Feed delayed" : state.fixture === "unsupported" ? "Unsupported" : state.fixture === "offline" ? "Feed offline" : "Connecting";
      await expect(page.getByText(expectedStatus, { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Streaming", { exact: true })).toHaveCount(0);
      if (state.fixture === "unsupported") {
        await health.getByRole("button", { name: "Choose provider" }).click();
        await expect(page).toHaveURL(/\/app\/settings\/data-providers#settings\/data-providers\/broker-connections$/);
        await page.goBack();
        await expect(health).toBeVisible();
      }
      await expectStableScreenshot(page, `live-${state.fixture}`, { fullPage: false });
    });
  }
});
