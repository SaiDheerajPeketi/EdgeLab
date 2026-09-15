import { expect, test } from "@playwright/test";
import {
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
} from "./support/app";

test.describe("settings critical-state visual baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("dirty validation state remains actionable", async ({ page }) => {
    await gotoStable(page, "/app/settings/global#settings/journal/journal-defaults", {
      waitForNetworkIdle: false,
    });

    const currency = page.getByLabel("Currency");
    await expect(currency).toBeVisible();
    await currency.fill("U");
    await expect(page.getByRole("status").filter({ hasText: "Draft changes not applied" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Use a three-letter currency code" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply journal defaults" })).toBeDisabled();

    await expectStableScreenshot(page, "settings-dirty-validation", { fullPage: false });
  });

  test("cross-tab conflict keeps both recovery choices visible", async ({ page }) => {
    await gotoStable(page, "/app/settings/global#settings/appearance/settings-density", {
      waitForNetworkIdle: false,
    });
    await expect(page.getByLabel("Settings density")).toBeVisible();

    await page.evaluate(() => {
      const key = "edgelab.settings-center.v1.user-7001";
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        newValue: JSON.stringify({
          density: "compact",
          includeDiagnosticsByDefault: false,
        }),
        storageArea: window.localStorage,
      }));
    });

    const conflict = page.getByRole("alert").filter({ hasText: "Settings changed in another EdgeLab tab" });
    await expect(conflict).toBeVisible();
    await expect(conflict.getByRole("button", { name: "Use newer version" })).toBeVisible();
    await expect(conflict.getByRole("button", { name: "Keep this version" })).toBeVisible();

    const geometry = await conflict.evaluate((alert) => {
      const message = alert.querySelector<HTMLElement>("[data-settings-conflict-message]")!.getBoundingClientRect();
      const actions = alert.querySelector<HTMLElement>("[data-settings-conflict-actions]")!.getBoundingClientRect();
      const buttons = [...alert.querySelectorAll<HTMLElement>("button")].map((button) => button.getBoundingClientRect());
      return {
        actionsTop: actions.top,
        alertLeft: alert.getBoundingClientRect().left,
        alertRight: alert.getBoundingClientRect().right,
        buttonBottom: Math.max(...buttons.map((button) => button.bottom)),
        buttonLeft: Math.min(...buttons.map((button) => button.left)),
        buttonRight: Math.max(...buttons.map((button) => button.right)),
        messageBottom: message.bottom,
      };
    });
    expect(geometry.buttonLeft).toBeGreaterThanOrEqual(geometry.alertLeft);
    expect(geometry.buttonRight).toBeLessThanOrEqual(geometry.alertRight);
    expect(geometry.buttonBottom).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
    if ((await page.viewportSize())!.width < 640) {
      expect(geometry.actionsTop).toBeGreaterThanOrEqual(geometry.messageBottom);
    }

    await expectStableScreenshot(page, "settings-conflict", { fullPage: false });
  });
});
