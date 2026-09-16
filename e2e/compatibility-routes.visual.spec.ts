import { expect, test } from "@playwright/test";
import { UI_COMPATIBILITY_PATHS, type UiRouteGroup } from "../frontend/src/lib/uiRollout";
import { expectStableScreenshot, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

const groups = Object.entries(UI_COMPATIBILITY_PATHS) as Array<[UiRouteGroup, readonly string[]]>;

test.describe("exhaustive compatibility route parity", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page, { rollout: "fallback" });
    await seedApprovedSession(page);
  });

  for (const [group, paths] of groups) {
    test(`${group} maps every nested route and survives fallback round trips`, async ({ page }) => {
      for (const path of paths) {
        await gotoStable(page, path, { waitForNetworkIdle: false });
        await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:[?#]|$)`));
        await expect(page.locator(`[data-route-group="${group}"]`)).toHaveAttribute("data-ui-version", "fallback");
        await expect(page.locator(`[data-compatibility-renderer="${group}"]`)).toBeVisible();
        await expect(page.locator("#workspace-content")).toHaveCount(0);
      }

      const path = paths[0];
      let fallback = true;
      await page.route("**/api/ui/rollout", (route) => route.fulfill({ json: {
        revision: fallback ? "compatibility-a" : "modern-b", kill_switch: fallback,
        flags: { shell: true, journal: true, settings: true, chart: true, public: true },
      } }));
      await page.addInitScript(({ groupName }) => {
        localStorage.setItem(`edgelab.compatibility.${groupName}.data`, "preserved");
        sessionStorage.setItem(`edgelab.compatibility.${groupName}.draft`, "unsaved");
      }, { groupName: group });
      await gotoStable(page, path, { waitForNetworkIdle: false });
      const boundary = page.locator(`[data-route-group="${group}"]`);
      await expect(boundary).toHaveAttribute("data-ui-version", "fallback");
      await expectStableScreenshot(page, `compatibility-${group}`, { fullPage: false });

      fallback = false;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(boundary).toHaveAttribute("data-ui-version", "v2");
      await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:[?#]|$)`));

      fallback = true;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(boundary).toHaveAttribute("data-ui-version", "fallback");
      await expect(page.locator(`[data-compatibility-renderer="${group}"]`)).toBeVisible();
      await expect.poll(() => page.evaluate(({ groupName }) => ({
        data: localStorage.getItem(`edgelab.compatibility.${groupName}.data`),
        draft: sessionStorage.getItem(`edgelab.compatibility.${groupName}.draft`),
      }), { groupName: group })).toEqual({ data: "preserved", draft: "unsaved" });
    });
  }
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
