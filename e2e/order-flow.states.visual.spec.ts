import { expect, test, type Locator, type Page } from "@playwright/test";
import axe from "axe-core";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

const stateProjects = {
  loading: ["mobile", "tablet", "desktop", "tradingDesktop"],
  available: ["mobile", "tablet", "desktop", "tradingDesktop"],
  stale: ["mobile", "tablet", "desktop", "tradingDesktop"],
  unsupported: ["mobile", "tablet", "desktop", "tradingDesktop"],
  error: ["mobile", "tablet", "desktop", "tradingDesktop"],
} as const;

for (const [state, projects] of Object.entries(stateProjects)) {
  test(`${state} order-flow state is truthful and contained`, async ({ page }, testInfo) => {
    test.skip(!projects.includes(testInfo.project.name as never), `${state} is covered at its representative viewport.`);
    await installDeterminism(page);
    await seedApprovedSession(page);
    await seedState(page, state);
    await gotoStable(page, "/app/order-flow", { waitForNetworkIdle: false });

    const workspace = page.locator('[data-order-flow-state]');
    await expect(workspace).toHaveAttribute("data-order-flow-state", state);
    await expect(page).toHaveURL(/\/app\/order-flow$/);
    await expect(page.getByRole("heading", { level: 1, name: "Order flow" })).toBeVisible();
    await expectContained(page, workspace);

    if (state === "available") {
      await expect(workspace.locator('[data-order-flow-source="e2e-deterministic-fixture"]')).toBeVisible();
      await expect(page.getByText(/never used in production/i)).toBeVisible();
      await expect(page.getByRole("table", { name: "Order-flow price levels" })).toBeVisible();
    }
    if (state === "unsupported") {
      await expect(page.getByText(/will not infer footprint, delta, or imbalance values from OHLCV/i)).toBeVisible();
      await expect(page.getByRole("button", { name: "Configure data provider" })).toBeVisible();
    }
    if (state === "error") {
      await expect(page.getByRole("alert")).toContainText("No cached values are being presented as current market data.");
    }

    await expect(page).toHaveScreenshot(`order-flow-${state}.png`, { fullPage: false });
  });
}

test("order-flow route has no serious accessibility violations", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Semantic contract is viewport-independent.");
  await installDeterminism(page);
  await seedApprovedSession(page);
  await seedState(page, "available");
  await gotoStable(page, "/app/order-flow", { waitForNetworkIdle: false });
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: true } } });
    return result.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
  });
  expect(violations, violations.map((item) => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
});

async function seedState(page: Page, state: string) {
  await page.addInitScript(({ value }) => {
    window.localStorage.setItem("edgelab.ui-test.order-flow-state", value);
  }, { value: state });
}

async function expectContained(page: Page, subject: Locator) {
  const [box, viewport, overflow] = await Promise.all([
    subject.boundingBox(),
    Promise.resolve(page.viewportSize()),
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ]);
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(overflow).toBeLessThanOrEqual(1);
}
