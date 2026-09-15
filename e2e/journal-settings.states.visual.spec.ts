import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
} from "./support/app";

const route = "/app/journal/settings#settings/journal/journal-defaults";

test.describe("journal settings state baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
    await gotoStable(page, route, { waitForNetworkIdle: false });
    await expect(page.getByRole("heading", { name: "Journal defaults" })).toBeVisible();
  });

  test("dirty state remains contained and actionable", async ({ page }) => {
    await page.getByLabel("Broker label").fill("Frankfurt futures desk");

    await expect(page.getByRole("status").filter({ hasText: "Draft changes not applied" })).toBeVisible();
    const apply = page.getByRole("button", { name: "Apply journal defaults" });
    await expect(apply).toBeEnabled();
    await expectControlGeometry(page, apply);
    await expectStableScreenshot(page, "journal-settings-dirty", { fullPage: false });
  });

  test("saving state announces progress and prevents duplicate submission", async ({ page }) => {
    await page.getByLabel("Broker label").fill("Frankfurt futures desk");
    const apply = page.getByRole("button", { name: "Apply journal defaults" });
    await apply.click();

    await expect(page.getByRole("status").filter({ hasText: "Saving…" })).toBeVisible();
    await expect(apply).toBeDisabled();
    await expectControlGeometry(page, apply);
    await expectStableScreenshot(page, "journal-settings-saving", { fullPage: false });
  });

  test("saved state announces completion and clears dirty state", async ({ page }) => {
    await page.getByLabel("Broker label").fill("Frankfurt futures desk");
    const apply = page.getByRole("button", { name: "Apply journal defaults" });
    await apply.click();

    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await expect(page.getByText("All explicit changes applied")).toBeVisible();
    await expect(apply).toBeDisabled();
    await expectStableScreenshot(page, "journal-settings-saved", { fullPage: false });
  });

  test("validation error is programmatically associated with currency", async ({ page }) => {
    const currency = page.getByLabel("Currency");
    await currency.fill("U");

    const error = page.getByRole("alert").filter({ hasText: "Use a three-letter currency code" });
    await expect(error).toBeVisible();
    await expect(currency).toHaveAttribute("aria-invalid", "true");
    await expect(currency).toHaveAttribute("aria-describedby", "setting-journal-defaults-validation");
    await expect(page.getByRole("button", { name: "Apply journal defaults" })).toBeDisabled();
    await expectControlGeometry(page, currency);
    await expectStableScreenshot(page, "journal-settings-validation-error", { fullPage: false });
  });
});

async function expectControlGeometry(page: Page, control: Locator) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual((await page.viewportSize())!.width);
  if ((await page.viewportSize())!.width < 900) {
    expect(box!.height).toBeGreaterThanOrEqual(40);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
