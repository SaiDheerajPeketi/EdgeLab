import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";

const budgets = JSON.parse(readFileSync(new URL("../docs/ui-performance-budgets.json", import.meta.url), "utf8")) as {
  runtime: { interactionP95Ms: number; sixteenPaneFrameP95Ms: number; sixteenPaneResizeStressP95Ms: number };
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
  await page.waitForTimeout(1_500);

  const client = await page.context().newCDPSession(page);
  const metricsPath = testInfo.outputPath("low-power-performance.json");
  const report: Record<string, unknown> = { phase: "collecting" };
  let before: { metrics: Array<{ name: string; value: number }> } | null = null;
  let throttled = false;
  try {
    await client.send("Performance.enable");
    before = await client.send("Performance.getMetrics");
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    throttled = true;

    const surface = page.locator(".chart-pane-shell").nth(1).locator(".tv-lightweight-charts").first();
    const bounds = await surface.boundingBox();
    const observedTimes = (await page.locator(".chart-ohlcv-time").allTextContents()).map((value) => new Set([value]));
    const allFrames: number[] = [];
    if (bounds) {
      let previous = await page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(resolve)));
      for (let index = 0; index < 120; index += 1) {
        await page.mouse.move(bounds.x + bounds.width * ([0.2, 0.5, 0.8][index % 3] ?? 0.5), bounds.y + bounds.height * 0.45);
        const observation = await page.evaluate(() => new Promise<{ current: number; times: string[] }>((resolve) => {
          requestAnimationFrame((current) => resolve({
            current,
            times: [...document.querySelectorAll<HTMLElement>(".chart-ohlcv-time")].map((node) => node.textContent ?? ""),
          }));
        }));
        allFrames.push(observation.current - previous);
        observation.times.forEach((value, paneIndex) => observedTimes[paneIndex]?.add(value));
        previous = observation.current;
      }
    }
    const frames = allFrames.slice(20);
    report.frameP95Ms = p95(frames);
    report.frames = frames;
    report.representativeWorkload = {
      dispatchedCrosshairUpdates: allFrames.length,
      panesWithChangingOhlc: observedTimes.filter((times) => times.size >= 2).length,
    };

    const resizeStress = await page.evaluate(async () => {
      const grid = document.querySelector<HTMLElement>(".chart-pane-grid");
      const stages = [...document.querySelectorAll<HTMLElement>(".chart-stage")];
      const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const snapshot = () => stages.map((stage) => {
        const canvases = [...stage.querySelectorAll<HTMLCanvasElement>(".tv-lightweight-charts canvas")];
        return {
          canvasSignature: canvases.map((canvas) => `${canvas.width}x${canvas.height}`).join("|"),
          canvasCount: canvases.length,
          containerWidth: stage.getBoundingClientRect().width,
          validCanvases: canvases.length > 0 && canvases.every((canvas) => canvas.width > 0 && canvas.height > 0),
        };
      });
      if (!grid || stages.length !== 16) return { collectionError: "Dense 16-pane chart grid is unavailable", durations: [] };
      const initial = snapshot();
      const changedCanvases = new Set<number>();
      const changedContainers = new Set<number>();
      const durations: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const shrink = index % 2 === 0;
        const start = performance.now();
        grid.style.width = shrink ? "calc(100% - 16px)" : "100%";
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await settle();
          const current = snapshot();
          current.forEach((size, paneIndex) => {
            if (size.canvasSignature !== initial[paneIndex].canvasSignature) changedCanvases.add(paneIndex);
            if (Math.abs(size.containerWidth - initial[paneIndex].containerWidth) >= 4) changedContainers.add(paneIndex);
          });
          const targetReached = shrink
            ? changedCanvases.size === 16 && changedContainers.size === 16
            : current.every((size, paneIndex) => size.canvasSignature === initial[paneIndex].canvasSignature
              && Math.abs(size.containerWidth - initial[paneIndex].containerWidth) < 0.5);
          if (targetReached) break;
        }
        durations.push(performance.now() - start);
      }
      grid.style.removeProperty("width");
      let restored = snapshot();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await settle();
        restored = snapshot();
        if (restored.every((size, paneIndex) => size.canvasSignature === initial[paneIndex].canvasSignature
          && Math.abs(size.containerWidth - initial[paneIndex].containerWidth) < 0.5)) break;
      }
      return {
        backingCanvasCounts: initial.map((size) => size.canvasCount),
        changedCanvases: changedCanvases.size,
        changedContainers: changedContainers.size,
        durations,
        initialValidCanvases: initial.filter((size) => size.validCanvases).length,
        iterations: durations.length,
        restoredCanvases: restored.filter((size, paneIndex) => changedCanvases.has(paneIndex)
          && size.canvasSignature === initial[paneIndex].canvasSignature).length,
        restoredContainers: restored.filter((size, paneIndex) => changedContainers.has(paneIndex)
          && Math.abs(size.containerWidth - initial[paneIndex].containerWidth) < 0.5).length,
      };
    });
    report.resizeStress = resizeStress;
    report.resizeStressP95Ms = p95(resizeStress.durations);

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
    report.interactions = interactions;
    report.interactionP95Ms = p95(interactions);
  } catch (error) {
    report.collectionError = error instanceof Error ? error.message : String(error);
  } finally {
    if (before) {
      const after = await client.send("Performance.getMetrics").catch(() => null);
      if (after) {
        const value = (result: typeof before, name: string) => result.metrics.find((item) => item.name === name)?.value ?? 0;
        report.layoutCountDelta = value(after, "LayoutCount") - value(before, "LayoutCount");
        report.recalcStyleCountDelta = value(after, "RecalcStyleCount") - value(before, "RecalcStyleCount");
        report.taskDurationDelta = value(after, "TaskDuration") - value(before, "TaskDuration");
      }
    }
    report.phase = "complete";
    writeFileSync(metricsPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[low-power-performance] ${JSON.stringify(report)}`);
    await testInfo.attach("low-power-performance.json", { contentType: "application/json", path: metricsPath });
    if (throttled) await client.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);
    await client.detach().catch(() => undefined);
  }

  const workload = report.representativeWorkload as { dispatchedCrosshairUpdates: number; panesWithChangingOhlc: number } | undefined;
  const resize = report.resizeStress as { changedCanvases?: number; changedContainers?: number; initialValidCanvases?: number; iterations?: number; restoredCanvases?: number; restoredContainers?: number } | undefined;
  const failures = [
    report.collectionError ? `collection: ${report.collectionError}` : null,
    workload?.dispatchedCrosshairUpdates === 120 ? null : `crosshair updates: ${workload?.dispatchedCrosshairUpdates ?? 0} !== 120`,
    workload?.panesWithChangingOhlc === 16 ? null : `OHLC panes: ${workload?.panesWithChangingOhlc ?? 0} !== 16`,
    resize?.iterations === 20 ? null : `resize iterations: ${resize?.iterations ?? 0} !== 20`,
    resize?.initialValidCanvases === 16 ? null : `valid backing canvases: ${resize?.initialValidCanvases ?? 0} !== 16`,
    resize?.changedContainers === 16 ? null : `changed containers: ${resize?.changedContainers ?? 0} !== 16`,
    resize?.changedCanvases === 16 ? null : `changed canvases: ${resize?.changedCanvases ?? 0} !== 16`,
    resize?.restoredContainers === 16 ? null : `restored changed containers: ${resize?.restoredContainers ?? 0} !== 16`,
    resize?.restoredCanvases === 16 ? null : `restored changed canvases: ${resize?.restoredCanvases ?? 0} !== 16`,
    Number(report.frameP95Ms) <= budgets.runtime.sixteenPaneFrameP95Ms ? null : `frame P95: ${report.frameP95Ms} > ${budgets.runtime.sixteenPaneFrameP95Ms}`,
    Number(report.resizeStressP95Ms) <= budgets.runtime.sixteenPaneResizeStressP95Ms ? null : `resize P95: ${report.resizeStressP95Ms} > ${budgets.runtime.sixteenPaneResizeStressP95Ms}`,
    Number(report.interactionP95Ms) <= budgets.runtime.interactionP95Ms ? null : `interaction P95: ${report.interactionP95Ms} > ${budgets.runtime.interactionP95Ms}`,
  ].filter((failure): failure is string => Boolean(failure));
  expect(failures, failures.join("\n")).toEqual([]);
});
