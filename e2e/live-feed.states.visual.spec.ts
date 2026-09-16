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
        const actionName = state.fixture === "unsupported" ? "Choose provider" : state.fixture === "stale" ? "Reconnect" : "Try again";
        await expect(health.getByRole("button", { name: actionName })).toBeVisible();
      }
      await expectStableScreenshot(page, `live-${state.fixture}`, { fullPage: false });
    });
  }
});
