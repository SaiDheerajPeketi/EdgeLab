import { expect, test, type Page } from "@playwright/test";
import { UI_COMPATIBILITY_PATHS, UI_COMPATIBILITY_ROUTE_PARITY, type CompatibilityRouteParity, type UiRouteGroup } from "../frontend/src/lib/uiRollout";
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
        const contract = UI_COMPATIBILITY_ROUTE_PARITY[path];
        expect(contract).toBeTruthy();
        expect(contract.requiredViewports).toEqual(["mobile", "desktop"]);
        await gotoStable(page, path, { waitForNetworkIdle: false });
        await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:[?#]|$)`));
        await expect(page.locator(`[data-route-group="${group}"]`)).toHaveAttribute("data-ui-version", "fallback");
        await expect(page.locator(`[data-compatibility-renderer="${group}"]`)).toBeVisible();
        await expect(page.locator("#workspace-content")).toHaveCount(0);
        if (contract.kind === "read-only") expect(contract.draftKey).toBeNull();
      }

      const path = representativePath(group, paths);
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
      await expectCompatibilityDomainState(page, group);
      await executeCompatibilityPrimaryAction(page, UI_COMPATIBILITY_ROUTE_PARITY[path]);
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
      await expectCompatibilityDomainState(page, group);
    });

    test(`${group} preserves its active domain state from modern to fallback and back`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === "tablet", "Bidirectional domain parity is sampled at mobile and desktop widths.");
      let fallback = false;
      await page.route("**/api/ui/rollout", (route) => route.fulfill({ json: {
        revision: fallback ? "rollback-domain" : "modern-domain", kill_switch: fallback,
        flags: { shell: true, journal: true, settings: true, chart: true, public: true },
      } }));
      const path = representativePath(group, paths);
      await gotoStable(page, path, { waitForNetworkIdle: false });
      let boundary = page.locator(`[data-route-group="${group}"]`);
      await expect(boundary).toHaveAttribute("data-ui-version", "v2");
      fallback = true;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(boundary).toHaveAttribute("data-ui-version", "fallback");
      await expectCompatibilityDomainState(page, group);
      fallback = false;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      boundary = page.locator(`[data-route-group="${group}"]`);
      await expect(boundary).toHaveAttribute("data-ui-version", "v2");
      await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:[?#]|$)`));
    });
  }
});

async function expectCompatibilityDomainState(page: Page, group: UiRouteGroup) {
  if (group === "public") await expect(page.getByRole("heading", { name: "Trade replay without losing your work" })).toBeVisible();
  else if (group === "shell") await expect(page.getByText(/Session restored for/)).toBeVisible();
  else if (group === "journal") await expect(page.getByRole("status").filter({ hasText: /recent trades available/ })).toBeVisible();
  else if (group === "settings") await expect(page.getByLabel("Workspace density")).toBeVisible();
  else {
    await expect(page.locator("[data-compatibility-replay]")).not.toHaveText("Loading active replay…");
    await expect(page.locator("[data-compatibility-chart]")).not.toHaveText("Loading chart layout…");
  }
}

async function executeCompatibilityPrimaryAction(page: Page, contract: CompatibilityRouteParity) {
  if (contract.primaryAction === "refresh-journal") {
    await page.getByRole("button", { name: "Refresh journal" }).click();
    await expect(page.getByRole("status").filter({ hasText: /recent trades available/ })).toBeVisible();
  } else if (contract.primaryAction === "save-settings") {
    await page.getByLabel("Workspace density").selectOption("compact");
    await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
  } else if (contract.primaryAction === "restore-replay-layout") {
    await expect(page.locator("[data-compatibility-replay]")).not.toHaveText("Loading active replay…");
  } else {
    expect(contract.kind).toBe("read-only");
    expect(contract.draftKey).toBeNull();
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function representativePath(group: UiRouteGroup, paths: readonly string[]) {
  if (group === "chart") return "/app/live";
  if (group === "settings") return "/app/settings/global";
  if (group === "journal") return "/app/journal/trades";
  return paths[0];
}
