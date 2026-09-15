import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";

const budgets = JSON.parse(readFileSync(new URL("../docs/ui-performance-budgets.json", import.meta.url), "utf8")) as {
  runtime: {
    interactionP95Ms: number;
    sixteenPaneFrameP95Ms: number;
    sixteenPaneResizeStressP95Ms: number;
  };
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
  const resizeStress = await page.evaluate(async () => {
    const grid = document.querySelector<HTMLElement>(".chart-pane-grid");
    if (!grid) throw new Error("Dense chart grid is unavailable");
    const stages = [...document.querySelectorAll<HTMLElement>(".chart-stage")];
    if (stages.length !== 16) throw new Error(`Expected 16 chart stages, received ${stages.length}`);
    const snapshot = () => stages.map((stage) => ({
      canvasWidth: stage.querySelector("canvas")?.width ?? 0,
      containerWidth: stage.getBoundingClientRect().width,
    }));
    const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const initial = snapshot();
    const samples = initial.map((size) => [size]);
    const durations: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const start = performance.now();
      grid.style.width = index % 2 === 0 ? "calc(100% - 4px)" : "100%";
      await settle();
      durations.push(performance.now() - start);
      snapshot().forEach((size, paneIndex) => samples[paneIndex].push(size));
    }
    grid.style.removeProperty("width");
    await settle();
    const restored = snapshot();
    return {
      changedCanvases: samples.filter((pane) => new Set(pane.map((size) => size.canvasWidth)).size >= 2).length,
      changedContainers: samples.filter((pane) => new Set(pane.map((size) => size.containerWidth)).size >= 2).length,
      durations,
      iterations: durations.length,
      restoredCanvases: restored.filter((size, index) => size.canvasWidth === initial[index].canvasWidth).length,
      restoredContainers: restored.filter((size, index) => Math.abs(size.containerWidth - initial[index].containerWidth) < 0.5).length,
    };
  });
  expect(resizeStress.iterations).toBe(20);
  expect(resizeStress.changedContainers).toBe(16);
  expect(resizeStress.changedCanvases).toBe(16);
  expect(resizeStress.restoredContainers).toBe(16);
  expect(resizeStress.restoredCanvases).toBe(16);
  await expect(page.locator(".chart-stage")).toHaveCount(16);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
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
    resizeStressP95Ms: p95(resizeStress.durations),
    resizeStress,
    layoutCountDelta: value(after, "LayoutCount") - value(before, "LayoutCount"),
    recalcStyleCountDelta: value(after, "RecalcStyleCount") - value(before, "RecalcStyleCount"),
    taskDurationDelta: value(after, "TaskDuration") - value(before, "TaskDuration"),
  };
  const metricsPath = testInfo.outputPath("low-power-performance.json");
  writeFileSync(metricsPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[low-power-performance] ${JSON.stringify(result)}`);
  await testInfo.attach("low-power-performance.json", { contentType: "application/json", path: metricsPath });
  expect(result.frameP95Ms).toBeLessThanOrEqual(budgets.runtime.sixteenPaneFrameP95Ms);
  expect(result.resizeStressP95Ms).toBeLessThanOrEqual(budgets.runtime.sixteenPaneResizeStressP95Ms);
  expect(result.interactionP95Ms).toBeLessThanOrEqual(budgets.runtime.interactionP95Ms);
});
