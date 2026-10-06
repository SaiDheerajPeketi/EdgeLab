import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  expectCertifiedScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
} from "./support/app";
import { installJournalSettingsFixture } from "./support/compatibility-journal-settings";

const route = "/app/journal/settings#settings/journal/journal-defaults";
let releaseJournalSave: () => void;

test.describe("journal settings state baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
    const state = await installJournalSettingsFixture(page, { setup: false });
    state.fallback = false;
    state.journals.delete(state.owner);
    state.templates.delete(state.owner);
    state.defaultsGate = new Promise<void>((resolve) => { releaseJournalSave = resolve; });
    await gotoStable(page, route, { waitForNetworkIdle: false });
    await expect(page.getByRole("heading", { name: "Journal defaults" })).toBeVisible();
  });

  test("dirty state remains contained and actionable", async ({ page }) => {
    await page.getByLabel("Broker label").fill("Frankfurt futures desk");

    await expect(page.getByRole("status").filter({ hasText: "Draft changes not applied" })).toBeVisible();
    const apply = page.getByRole("button", { name: "Apply journal defaults" });
    await expect(apply).toBeEnabled();
    await expectControlGeometry(page, apply);
    await expectCommandLauncherClearOfInteractiveControls(page);
    await expectStateScreenshot(page, "journal-settings-dirty");
  });

  test("saving state announces progress and prevents duplicate submission", async ({ page }) => {
    await page.getByLabel("Broker label").fill("Frankfurt futures desk");
    const apply = page.getByRole("button", { name: "Apply journal defaults" });
    await apply.click();

    await expect(page.getByRole("status").filter({ hasText: "Saving journal defaults…" })).toBeVisible();
    await expect(apply).toBeDisabled();
    await expectControlGeometry(page, apply);
    await expectCommandLauncherClearOfInteractiveControls(page);
    await expectStateScreenshot(page, "journal-settings-saving");
  });

  test("saved state announces completion and clears dirty state", async ({ page }) => {
    await page.getByLabel("Broker label").fill("Frankfurt futures desk");
    const apply = page.getByRole("button", { name: "Apply journal defaults" });
    await apply.click();
    releaseJournalSave();

    await expect(page.getByRole("status").filter({ hasText: "Journal defaults saved" })).toBeVisible();
    await expect(page.getByText("All explicit changes applied")).toBeVisible();
    await expect(apply).toBeDisabled();
    await expectCommandLauncherClearOfInteractiveControls(page);
    await expectStateScreenshot(page, "journal-settings-saved");
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
    await expectStateScreenshot(page, "journal-settings-validation-error");
  });

  test("global settings keeps the docked command entry clear of content", async ({ page }) => {
    await gotoStable(page, "/app/settings/global", { waitForNetworkIdle: false });
    const regional = page.getByRole("heading", { name: "Language, time zone, and number format" });
    await expect(regional).toBeVisible();
    await expectCommandLauncherClearOfInteractiveControls(page);
  });
});

async function expectStateScreenshot(page: Page, name: string) {
  await expectCertifiedScreenshot(page, page, `${name}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    maxDiffPixelRatio: 0.0001,
    threshold: 0.05,
  });
}

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

async function expectCommandLauncherClearOfInteractiveControls(page: Page) {
  const launcher = page.getByRole("button", { name: "Open command palette" });
  await expect(launcher).toBeVisible();
  const launcherBox = await launcher.boundingBox();
  expect(launcherBox).not.toBeNull();
  const controls = page.locator("main button, main input, main select, main textarea, main a[href]");
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    const controlBox = await control.boundingBox();
    if (!controlBox) continue;
    const intersects = controlBox.x < launcherBox!.x + launcherBox!.width
      && controlBox.x + controlBox.width > launcherBox!.x
      && controlBox.y < launcherBox!.y + launcherBox!.height
      && controlBox.y + controlBox.height > launcherBox!.y;
    expect(intersects, `Commands overlaps ${await control.getAttribute("aria-label") ?? await control.textContent() ?? control.evaluate((element) => element.tagName)}`).toBe(false);
  }
}
