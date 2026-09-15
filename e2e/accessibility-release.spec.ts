import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";

async function expectNoSeriousAccessibilityViolations(page: Page) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: true } },
    });
    return result.violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
      .map(({ help, id, nodes }) => ({ help, id, targets: nodes.map((node) => node.target) }));
  });
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test.describe("representative accessibility release audit", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
    await seedChartLayout(page, "single");
  });

  for (const surface of [
    { name: "live chart", path: "/app/live" },
    { name: "journal dashboard", path: "/app/journal/dashboard" },
    { name: "reports", path: "/app/reports" },
    { name: "settings", path: "/app/settings/global" },
  ]) {
    test(`${surface.name} has no serious axe or contrast violations`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "The semantic and dark-theme contract is viewport-independent.");
      await gotoStable(page, surface.path, { waitForNetworkIdle: false });
      await expectNoSeriousAccessibilityViolations(page);
    });
  }

  test("chart exposes a summary and recent-bar table without color", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The chart alternative is audited once.");
    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    const chart = page.getByRole("region", { name: /chart/i }).first();
    await expect(chart.locator(".sr-only").first()).toContainText(/Latest bar|No bars are currently available/);
    const table = chart.getByRole("table", { name: /recent price bars/i });
    await expect(table).toHaveCount(1);
    await expect(table.getByRole("columnheader")).toHaveCount(6);
  });
});

declare global {
  interface Window { axe: typeof axe }
}
