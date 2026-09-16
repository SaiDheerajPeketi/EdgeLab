import { expect, test, type Locator } from "@playwright/test";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

test.describe("Journal trades native choice controls", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "desktop", "Coarse-pointer geometry is exercised by touch projects.");
    await installDeterminism(page);
    await seedApprovedSession(page);
    await gotoStable(page, "/app/journal/trades", { waitForNetworkIdle: false });
    await expect(page.getByRole("heading", { name: "Trades", exact: true })).toBeVisible();
  });

  test("native checkboxes remain compact inside 44px keyboard-operable labels", async ({ page }) => {
    const selectAll = page.getByRole("checkbox", { name: "Select all visible trades" });
    const firstTrade = page.getByRole("checkbox", { name: /^Select .+ trade$/ }).first();
    const reviewQueue = page.getByRole("checkbox", { name: "Review queue" });

    await expectChoiceGeometry(selectAll);
    await expectChoiceGeometry(firstTrade);
    await expectChoiceGeometry(reviewQueue);

    await selectAll.focus();
    await expect(selectAll).toBeFocused();
    await page.keyboard.press("Space");
    await expect(selectAll).toBeChecked();
    await expect(firstTrade).toBeChecked();

    await reviewQueue.focus();
    await expect(reviewQueue).toBeFocused();
    await page.keyboard.press("Space");
    await expect(reviewQueue).toBeChecked();
  });
});

async function expectChoiceGeometry(control: Locator) {
  const inputBox = await control.boundingBox();
  const label = control.locator("xpath=ancestor::label");
  const labelBox = await label.boundingBox();
  expect(inputBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(inputBox!.width).toBeGreaterThanOrEqual(12);
  expect(inputBox!.height).toBeGreaterThanOrEqual(12);
  expect(inputBox!.width).toBeLessThanOrEqual(24);
  expect(inputBox!.height).toBeLessThanOrEqual(24);
  expect(labelBox!.width).toBeGreaterThanOrEqual(44);
  expect(labelBox!.height).toBeGreaterThanOrEqual(44);
}
