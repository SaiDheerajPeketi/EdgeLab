import { expect, test, type Route } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";

const budgets = JSON.parse(readFileSync(new URL("../docs/ui-performance-budgets.json", import.meta.url), "utf8")) as {
  runtime: { interactionP95Ms: number; sixteenPaneFanoutMs: number; sixteenPaneFrameP95Ms: number; sixteenPaneResizeStressP95Ms: number };
};
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Infinity;

test("populated 16-pane workspace meets low-power budgets", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await installDeterminism(page);
  await seedApprovedSession(page);
  const activeSubscriptions = new Map<string, { channels: string[]; instrument_id: number; pane_id: string }>();
  const subscriptionLifecycle: Array<{ id: string; method: "DELETE" | "POST" }> = [];
  let subscriptionSequence = 0;
  const subscriptionCorsHeaders = {
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-origin": "*",
  };
  await page.route("**/api/market-data/instruments/*/candles**", (route) => route.fulfill({ json: Array.from({ length: 240 }, (_, index) => {
    const open = 67_500 + index * 5;
    return { start_at: new Date(Date.parse("2026-09-15T00:00:00Z") + index * 300_000).toISOString(), open, high: open + 30, low: open - 25, close: open + 10, volume: 80 + index };
  }) }));
  const handleSubscriptionRoute = async (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ headers: subscriptionCorsHeaders, status: 204 });
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as { channels: string[]; instrument_id: number; pane_id: string };
      const id = `perf-${++subscriptionSequence}`;
      activeSubscriptions.set(id, payload);
      subscriptionLifecycle.push({ id, method: "POST" });
      return route.fulfill({ headers: subscriptionCorsHeaders, json: { ...payload, subscription_id: id, queued_events: 0, dropped_events: 0 } });
    }
    if (route.request().method() === "DELETE") {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
      activeSubscriptions.delete(id);
      subscriptionLifecycle.push({ id, method: "DELETE" });
      return route.fulfill({ headers: subscriptionCorsHeaders, json: { ok: true } });
    }
    return route.fulfill({ headers: subscriptionCorsHeaders, json: { ok: true } });
  };
  await page.route("**/api/market-data/subscriptions", handleSubscriptionRoute);
  await page.route("**/api/market-data/subscriptions/*", handleSubscriptionRoute);
  await page.route("**/api/market-data/instruments?**", (route) => {
    const symbol = new URL(route.request().url()).searchParams.get("search")?.trim().toUpperCase() || "BTCUSDT";
    const id = [...symbol].reduce((total, character) => total + character.charCodeAt(0), 1);
    return route.fulfill({ json: [{ id, canonical_symbol: symbol, display_name: symbol, asset_class: "CRYPTO", instrument_type: "SPOT", exchange: "FIXTURE", currency: "USD", timezone: "UTC", tick_size: "0.1", active: true, identifiers: [{ provider: "FIXTURE", provider_symbol: symbol }] }] });
  });
  await seedChartLayout(page, "single");
  await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
  await expect.poll(() => activeSubscriptions.size).toBe(1);
  await expect(page.locator(".chart-ohlcv-time", { hasText: "No candle" })).toHaveCount(0);
  await page.waitForTimeout(100);
  const initialSubscriptionIds = [...activeSubscriptions.keys()];
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("radio", { name: "4 × 4 grid · 16 charts" }).click();
  await expect(page.locator('[data-chart-engines-ready="true"]')).toHaveCount(1);
  await expect(page.locator(".chart-stage")).toHaveCount(16);
  await expect(page.locator(".chart-ohlcv-time")).toHaveCount(16);
  await expect(page.locator(".chart-ohlcv-time", { hasText: "No candle" })).toHaveCount(0);
  const subscriptionDescriptors = await page.locator(".chart-stage").evaluateAll((stages) => stages.map((stage) => ({
    key: stage.getAttribute("data-market-subscription-key"),
    paneId: stage.getAttribute("data-market-pane-id"),
  })).filter((descriptor): descriptor is { key: string; paneId: string } => Boolean(descriptor.key && descriptor.paneId)));
  const subscriptionKeys = subscriptionDescriptors.map(({ key }) => key);
  const uniqueSubscriptionKeys = new Set(subscriptionKeys);
  const keyByPaneId = new Map(subscriptionDescriptors.map(({ key, paneId }) => [paneId, key]));
  try {
    await expect.poll(() => ({
      active: activeSubscriptions.size,
      initialRemoved: initialSubscriptionIds.every((id) => !activeSubscriptions.has(id)),
      keys: [...activeSubscriptions.values()].map(({ pane_id }) => keyByPaneId.get(pane_id)).filter(Boolean).sort(),
    })).toEqual({ active: uniqueSubscriptionKeys.size, initialRemoved: true, keys: [...uniqueSubscriptionKeys].sort() });
  } catch (error) {
    console.error(`[subscription-lifecycle] ${JSON.stringify({ active: [...activeSubscriptions.entries()], initialSubscriptionIds, subscriptionLifecycle })}`);
    throw error;
  }
  await page.waitForTimeout(1_500);

  const client = await page.context().newCDPSession(page);
  const metricsPath = testInfo.outputPath("low-power-performance.json");
  const report: Record<string, unknown> = {
    phase: "collecting",
    subscriptionWorkload: {
      expectedUniqueKeys: uniqueSubscriptionKeys.size,
      keys: [...uniqueSubscriptionKeys],
      active: activeSubscriptions.size,
      activeKeys: [...activeSubscriptions.values()].map(({ pane_id }) => keyByPaneId.get(pane_id)).filter(Boolean),
      lifecycle: subscriptionLifecycle,
    },
  };
  let before: { metrics: Array<{ name: string; value: number }> } | null = null;
  let throttled = false;
  try {
    await client.send("Performance.enable");
    before = await client.send("Performance.getMetrics");
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    throttled = true;

    const surface = page.locator(".chart-pane-shell").first().locator(".tv-lightweight-charts").first();
    await surface.scrollIntoViewIfNeeded();
    const bounds = await surface.boundingBox();
    let frameWorkload: {
      deliveredInputs: number;
      finalFanoutLatencyMs: number;
      finalFanoutMatchedPanes: number;
      finalFanoutSourceChanged: boolean;
      finalFanoutValue: string | null;
      frames: number[];
      panesWithChangingOhlc: number;
      processedCrosshairUpdates: number;
    } = {
      deliveredInputs: 0,
      finalFanoutLatencyMs: -1,
      finalFanoutMatchedPanes: 0,
      finalFanoutSourceChanged: false,
      finalFanoutValue: null,
      frames: [],
      panesWithChangingOhlc: 0,
      processedCrosshairUpdates: 0,
    };
    if (bounds) {
      await page.evaluate(() => {
        const target = window as typeof window & {
          __edgePerfCleanup?: () => void;
          __edgePerfDelivered?: number;
          __edgePerfFrames?: number[];
          __edgePerfOhlc?: string[][];
          __edgePerfProcessed?: number;
          __edgePerfStopFrames?: () => void;
        };
        const nodes = [...document.querySelectorAll<HTMLElement>(".chart-ohlcv-time")];
        target.__edgePerfDelivered = 0;
        target.__edgePerfFrames = [];
        target.__edgePerfOhlc = nodes.map((node) => [node.textContent ?? ""]);
        target.__edgePerfProcessed = 0;
        const observer = new MutationObserver(() => nodes.forEach((node, index) => {
          const value = node.textContent ?? "";
          const seen = target.__edgePerfOhlc?.[index];
          if (seen && !seen.includes(value)) {
            seen.push(value);
            target.__edgePerfProcessed = (target.__edgePerfProcessed ?? 0) + 1;
          }
        }));
        nodes.forEach((node) => observer.observe(node, { characterData: true, childList: true, subtree: true }));
        const recordInput = () => {
          target.__edgePerfDelivered = (target.__edgePerfDelivered ?? 0) + 1;
          const startedAt = performance.now();
          requestAnimationFrame(() => target.__edgePerfFrames?.push(performance.now() - startedAt));
        };
        document.addEventListener("mousemove", recordInput, true);
        target.__edgePerfStopFrames = () => document.removeEventListener("mousemove", recordInput, true);
        target.__edgePerfCleanup = () => {
          target.__edgePerfStopFrames?.();
          observer.disconnect();
        };
      });
      for (let index = 0; index < 120; index += 1) {
        await page.mouse.move(bounds.x + bounds.width * ([0.2, 0.5, 0.8][index % 3] ?? 0.5), bounds.y + bounds.height * 0.45);
        await page.evaluate((expected) => new Promise<void>((resolve) => {
          const waitForPaint = () => {
            const frames = (window as typeof window & { __edgePerfFrames?: number[] }).__edgePerfFrames ?? [];
            if (frames.length >= expected) resolve();
            else requestAnimationFrame(waitForPaint);
          };
          waitForPaint();
        }), index + 1);
      }
      const settleFrames = () => page.evaluate(() => new Promise<void>((resolve) => {
        let remaining = 8;
        const settle = () => {
          remaining -= 1;
          if (remaining === 0) resolve();
          else requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);
      }));
      await page.evaluate(() => {
        (window as typeof window & { __edgePerfStopFrames?: () => void }).__edgePerfStopFrames?.();
      });
      const readSourceCandle = (fraction: number) => page.evaluate(({ x, y }) => {
        const shell = document.elementFromPoint(x, y)?.closest<HTMLElement>(".chart-pane-shell");
        return shell?.querySelector<HTMLElement>(".chart-ohlcv-time")?.textContent ?? "";
      }, { x: bounds.x + bounds.width * fraction, y: bounds.y + bounds.height * 0.45 });
      const calibration: Array<{ fraction: number; value: string }> = [];
      for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        await page.mouse.move(bounds.x + bounds.width * fraction, bounds.y + bounds.height * 0.45);
        await settleFrames();
        calibration.push({ fraction, value: await readSourceCandle(fraction) });
        if (calibration.length > 1 && calibration.at(-1)?.value !== calibration[0]?.value) break;
      }
      const initialCalibration = calibration[0];
      const finalCalibration = calibration.find(({ value }) => value !== initialCalibration?.value);
      expect(initialCalibration?.value).toBeTruthy();
      expect(finalCalibration?.value).toBeTruthy();
      if (!initialCalibration || !finalCalibration) throw new Error(`Unable to calibrate distinct chart candles: ${JSON.stringify(calibration)}`);
      const finalSourceBefore = initialCalibration.value;
      const expectedFinalValue = finalCalibration.value;
      await page.mouse.move(bounds.x + bounds.width * initialCalibration.fraction, bounds.y + bounds.height * 0.45);
      await expect.poll(() => readSourceCandle(initialCalibration.fraction)).toBe(finalSourceBefore);
      await page.evaluate(({ expectedFinalValue, finalSourceBefore }) => {
        const target = window as typeof window & {
          __edgePerfExpectedFinalValue?: string;
          __edgePerfFinalSourceBefore?: string;
          __edgePerfFinalStartedAt?: number;
        };
        target.__edgePerfExpectedFinalValue = expectedFinalValue;
        target.__edgePerfFinalSourceBefore = finalSourceBefore;
        const markFinalInput = () => {
          target.__edgePerfFinalStartedAt = performance.now();
          document.removeEventListener("mousemove", markFinalInput, true);
        };
        document.addEventListener("mousemove", markFinalInput, true);
      }, { expectedFinalValue, finalSourceBefore });
      await page.mouse.move(bounds.x + bounds.width * finalCalibration.fraction, bounds.y + bounds.height * 0.45);
      const finalFanout = await page.evaluate(async () => {
        const target = window as typeof window & {
          __edgePerfExpectedFinalValue?: string;
          __edgePerfFinalSourceBefore?: string;
          __edgePerfFinalStartedAt?: number;
        };
        let finalFanoutMatchedPanes = 0;
        let finalFanoutSourceChanged = false;
        let finalFanoutValue: string | null = null;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const values = [...document.querySelectorAll<HTMLElement>(".chart-ohlcv-time")].map((node) => node.textContent ?? "");
          finalFanoutValue = values[0] ?? null;
          finalFanoutSourceChanged = finalFanoutValue === target.__edgePerfExpectedFinalValue && finalFanoutValue !== target.__edgePerfFinalSourceBefore;
          finalFanoutMatchedPanes = values.filter((value) => value === target.__edgePerfExpectedFinalValue).length;
          if (finalFanoutSourceChanged && finalFanoutMatchedPanes === values.length) break;
        }
        return {
          finalFanoutLatencyMs: target.__edgePerfFinalStartedAt == null ? -1 : performance.now() - target.__edgePerfFinalStartedAt,
          finalFanoutMatchedPanes,
          finalFanoutSourceChanged,
          finalFanoutValue,
        };
      });
      const observedWorkload = await page.evaluate(() => {
        const target = window as typeof window & {
          __edgePerfCleanup?: () => void;
          __edgePerfDelivered?: number;
          __edgePerfFrames?: number[];
          __edgePerfOhlc?: string[][];
          __edgePerfProcessed?: number;
        };
        target.__edgePerfCleanup?.();
        return {
          deliveredInputs: target.__edgePerfDelivered ?? 0,
          frames: target.__edgePerfFrames ?? [],
          panesWithChangingOhlc: (target.__edgePerfOhlc ?? []).filter((values) => values.length >= 2).length,
          processedCrosshairUpdates: target.__edgePerfProcessed ?? 0,
        };
      });
      frameWorkload = { ...observedWorkload, ...finalFanout };
    }
    const frames = frameWorkload.frames;
    report.frameP95Ms = p95(frames);
    report.frames = frames;
    report.representativeWorkload = {
      deliveredInputs: frameWorkload.deliveredInputs,
      finalFanoutLatencyMs: frameWorkload.finalFanoutLatencyMs,
      finalFanoutMatchedPanes: frameWorkload.finalFanoutMatchedPanes,
      finalFanoutSourceChanged: frameWorkload.finalFanoutSourceChanged,
      finalFanoutValue: frameWorkload.finalFanoutValue,
      panesWithChangingOhlc: frameWorkload.panesWithChangingOhlc,
      processedCrosshairUpdates: frameWorkload.processedCrosshairUpdates,
    };

    const resizeStress = await page.evaluate(async () => {
      const grid = document.querySelector<HTMLElement>(".chart-pane-grid");
      const stages = [...document.querySelectorAll<HTMLElement>(".chart-stage")];
      const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const snapshot = () => stages.map((stage) => {
        const canvases = [...stage.querySelectorAll<HTMLCanvasElement>(".tv-lightweight-charts canvas")];
        return {
          canvasSignature: canvases.map((canvas) => `${canvas.width}x${canvas.height}@${canvas.style.width}x${canvas.style.height}`).join("|"),
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
        if (shrink) grid.style.width = "calc(100% - 16px)";
        else grid.style.removeProperty("width");
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await settle();
          const current = snapshot();
          current.forEach((size, paneIndex) => {
            if (size.canvasSignature !== initial[paneIndex].canvasSignature) changedCanvases.add(paneIndex);
            if (Math.abs(size.containerWidth - initial[paneIndex].containerWidth) >= 4) changedContainers.add(paneIndex);
          });
          const targetReached = shrink
            ? current.every((size, paneIndex) => size.canvasSignature !== initial[paneIndex].canvasSignature
              && Math.abs(size.containerWidth - initial[paneIndex].containerWidth) >= 4)
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
    report.resizeShrinkP95Ms = p95(resizeStress.durations.filter((_duration, index) => index % 2 === 0));
    report.resizeRestoreP95Ms = p95(resizeStress.durations.filter((_duration, index) => index % 2 === 1));

    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const measureCommandPaletteOpen = () => page.evaluate(async () => {
        const start = performance.now();
        document.querySelector<HTMLButtonElement>('[aria-label="Open command palette"]')?.click();
        while (!document.querySelector('[role="dialog"][aria-label="EdgeLab command palette"]')) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return performance.now() - start;
      });
    for (let index = 0; index < 2; index += 1) {
      await measureCommandPaletteOpen();
      await expect(page.getByRole("dialog", { name: "EdgeLab command palette" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "EdgeLab command palette" })).toBeHidden();
    }
    const interactions: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      interactions.push(await measureCommandPaletteOpen());
      await expect(page.getByRole("dialog", { name: "EdgeLab command palette" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "EdgeLab command palette" })).toBeHidden();
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
    mkdirSync(dirname(metricsPath), { recursive: true });
    writeFileSync(metricsPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[low-power-performance] ${JSON.stringify(report)}`);
    await testInfo.attach("low-power-performance.json", { contentType: "application/json", path: metricsPath });
    if (throttled) await client.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);
    await client.detach().catch(() => undefined);
  }

  const workload = report.representativeWorkload as { deliveredInputs: number; finalFanoutLatencyMs: number; finalFanoutMatchedPanes: number; finalFanoutSourceChanged: boolean; panesWithChangingOhlc: number; processedCrosshairUpdates: number } | undefined;
  const resize = report.resizeStress as { changedCanvases?: number; changedContainers?: number; initialValidCanvases?: number; iterations?: number; restoredCanvases?: number; restoredContainers?: number } | undefined;
  const subscriptions = report.subscriptionWorkload as { active?: number; activeKeys?: string[]; expectedUniqueKeys?: number; keys?: string[]; lifecycle?: Array<{ method: string }> } | undefined;
  const failures = [
    report.collectionError ? `collection: ${report.collectionError}` : null,
    workload?.deliveredInputs === 120 ? null : `delivered chart inputs: ${workload?.deliveredInputs ?? 0} !== 120`,
    Number(workload?.processedCrosshairUpdates) > 0 ? null : "processed crosshair updates: 0",
    workload?.panesWithChangingOhlc === 16 ? null : `OHLC panes: ${workload?.panesWithChangingOhlc ?? 0} !== 16`,
    workload?.finalFanoutSourceChanged ? null : "final crosshair source candle did not change",
    workload?.finalFanoutMatchedPanes === 16 ? null : `final crosshair panes: ${workload?.finalFanoutMatchedPanes ?? 0} !== 16`,
    Number(workload?.finalFanoutLatencyMs) <= budgets.runtime.sixteenPaneFanoutMs ? null : `final crosshair fan-out: ${workload?.finalFanoutLatencyMs} > ${budgets.runtime.sixteenPaneFanoutMs}`,
    resize?.iterations === 20 ? null : `resize iterations: ${resize?.iterations ?? 0} !== 20`,
    resize?.initialValidCanvases === 16 ? null : `valid backing canvases: ${resize?.initialValidCanvases ?? 0} !== 16`,
    resize?.changedContainers === 16 ? null : `changed containers: ${resize?.changedContainers ?? 0} !== 16`,
    resize?.changedCanvases === 16 ? null : `changed canvases: ${resize?.changedCanvases ?? 0} !== 16`,
    resize?.restoredContainers === 16 ? null : `restored changed containers: ${resize?.restoredContainers ?? 0} !== 16`,
    resize?.restoredCanvases === 16 ? null : `restored changed canvases: ${resize?.restoredCanvases ?? 0} !== 16`,
    subscriptions?.active === subscriptions?.expectedUniqueKeys ? null : `active market subscriptions: ${subscriptions?.active ?? 0} !== ${subscriptions?.expectedUniqueKeys ?? 0}`,
    JSON.stringify([...(subscriptions?.activeKeys ?? [])].sort()) === JSON.stringify([...(subscriptions?.keys ?? [])].sort()) ? null : "active market subscription keys do not match the rendered normalized keys",
    subscriptions?.lifecycle?.some(({ method }) => method === "DELETE") ? null : "market subscription lifecycle did not retire the replaced single-pane stream",
    Number(report.frameP95Ms) <= budgets.runtime.sixteenPaneFrameP95Ms ? null : `frame P95: ${report.frameP95Ms} > ${budgets.runtime.sixteenPaneFrameP95Ms}`,
    Number(report.resizeStressP95Ms) <= budgets.runtime.sixteenPaneResizeStressP95Ms ? null : `resize P95: ${report.resizeStressP95Ms} > ${budgets.runtime.sixteenPaneResizeStressP95Ms}`,
    Number(report.interactionP95Ms) <= budgets.runtime.interactionP95Ms ? null : `interaction P95: ${report.interactionP95Ms} > ${budgets.runtime.interactionP95Ms}`,
  ].filter((failure): failure is string => Boolean(failure));
  expect(failures, failures.join("\n")).toEqual([]);
});
