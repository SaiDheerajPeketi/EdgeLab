import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { liveViewportSetup } from "./chart-viewport151.support";

test("chart keeps its price area and collapsed tools preserve width, hover, docking and Journal navigation", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = await liveViewportSetup(page);
  const surface = page.locator('[data-ui-surface="chart-live"]').first();
  const layout = surface.locator('[data-workspace-panel-layout]').first();
  const content = layout.locator(':scope > [data-workspace-panel-content]');
  const frame = surface.locator(".chart-frame").first();
  await expect(frame).toBeVisible();
  await expect(layout).toHaveAttribute("data-overlay-tools", "right");
  const bounds = await frame.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(info.project.name === "desktop" ? 568 : 260);
  const before = (await content.boundingBox())!.width;
  const directory = path.resolve(".artifacts/chart-space192", info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, "collapsed.png"), animations: "disabled" });
  const trigger = surface.locator("button.ui-workspace-panel-trigger");
  if (info.project.name === "desktop") {
    expect(before).toBeCloseTo((await layout.boundingBox())!.width, 0);
    await trigger.scrollIntoViewIfNeeded();
    const tools = (await trigger.boundingBox())!, feed = (await surface.locator(".command-header .status-pill").boundingBox())!;
    expect(tools.x >= feed.x + feed.width || feed.x >= tools.x + tools.width || tools.y >= feed.y + feed.height || feed.y >= tools.y + tools.height).toBe(true);
    await trigger.hover();
    const preview = surface.locator('aside[data-hover-preview="true"]');
    await expect(preview).toBeVisible();
    expect((await content.boundingBox())!.width).toBeCloseTo(before, 0);
    await page.mouse.move(5, 5);
    await expect(preview).toHaveCount(0);
    await trigger.click();
    await expect(layout).not.toHaveAttribute("data-overlay-tools");
    const panel = surface.getByRole("complementary", { name: "Chart tools", exact: true });
    await expect(panel).toBeVisible();
    expect((await content.boundingBox())!.width).toBeLessThan(before - 250);
    await panel.getByRole("button", { name: "Dock workspace panel to left", exact: true }).click();
    await expect(panel).toHaveAttribute("data-dock", "left");
    await panel.getByRole("button", { name: "Collapse workspace panel", exact: true }).click();
    await expect(layout).toHaveAttribute("data-overlay-tools", "left");
    expect((await content.boundingBox())!.width).toBeCloseTo(before, 0);
    await trigger.click();
    await expect(panel).toHaveAttribute("data-dock", "left");
    await page.screenshot({ path: path.join(directory, "pinned-left.png"), animations: "disabled" });
    await panel.getByRole("link", { name: "Full Journal", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/journal\/trades$/);
    await state.waitForAccountWrites();
    await page.reload();
    await expect(page.getByRole("region", { name: "Trades", exact: true }).getByRole("heading", { level: 1, name: "Trades", exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(directory, "receipt.json"), JSON.stringify({ priceBounds: bounds, contentWidth: before, errors,
    qualification: "Actual production chart and panel controls; controlled authenticated API/provider transport." }, null, 2));
});
