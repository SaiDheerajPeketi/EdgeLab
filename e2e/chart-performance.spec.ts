import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";

const budgets = JSON.parse(readFileSync(new URL("../docs/ui-performance-budgets.json", import.meta.url), "utf8")) as {
  runtime: { interactionP95Ms: number; sixteenPaneFrameP95Ms: number };
};
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Infinity;

test("populated 16-pane workspace meets low-power budgets", async ({ page }, testInfo) => {
  await installDeterminism(page);
  await seedApprovedSession(page);
  await seedChartLayout(page, "single");
  await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("radio", { name: "4 × 4 grid · 16 charts" }).click();
  await expect(page.locator('[data-chart-engines-ready="true"]')).toHaveCount(1);
  await expect(page.locator(".chart-stage")).toHaveCount(16);
  await expect(page.locator(".chart-ohlcv-time")).toHaveCount(16);
  await expect(page.locator(".chart-ohlcv-time", { hasText: "No candle" })).toHaveCount(0);

  const secondChart = page.locator(".chart-pane-shell").nth(1).getByRole("region", { name: /chart/i });
  await secondChart.focus();
  await expect(page.locator(".chart-pane-shell").nth(1)).toHaveClass(/chart-pane-shell-active/);
  await page.keyboard.down("Alt");
  await expect(page.getByRole("menu", { name: "Circular drawing toolbox" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.up("Alt");
  await expect(secondChart).toBeFocused();
  await page.waitForTimeout(1_500);

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const before = await client.send("Performance.getMetrics");
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const allFrames = await page.evaluate(async () => {
    const values: number[] = [];
    let previous = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < 120; index += 1) {
      const current = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      values.push(current - previous);
      previous = current;
    }
    return values;
  });
  const frames = allFrames.slice(20);
  const interactions: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    interactions.push(await page.evaluate(async () => {
      const start = performance.now();
      document.querySelector<HTMLButtonElement>('[aria-label="Open command palette"]')?.click();
      while (!document.querySelector('[role="dialog"][aria-label="EdgeLab command palette"]')) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return performance.now() - start;
    }));
    await expect(page.getByRole("dialog", { name: "EdgeLab command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  const after = await client.send("Performance.getMetrics");
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await client.detach();
  const value = (result: typeof before, name: string) => result.metrics.find((item) => item.name === name)?.value ?? 0;
  const result = {
    frameP95Ms: p95(frames), frames,
    interactionP95Ms: p95(interactions), interactions,
    layoutCountDelta: value(after, "LayoutCount") - value(before, "LayoutCount"),
    recalcStyleCountDelta: value(after, "RecalcStyleCount") - value(before, "RecalcStyleCount"),
    taskDurationDelta: value(after, "TaskDuration") - value(before, "TaskDuration"),
  };
  await testInfo.attach("low-power-performance.json", { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: "application/json" });
  expect(result.frameP95Ms).toBeLessThanOrEqual(budgets.runtime.sixteenPaneFrameP95Ms);
  expect(result.interactionP95Ms).toBeLessThanOrEqual(budgets.runtime.interactionP95Ms);
});
