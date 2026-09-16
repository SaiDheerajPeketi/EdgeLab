import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

const budgets = JSON.parse(readFileSync(new URL("../docs/ui-performance-budgets.json", import.meta.url), "utf8")) as {
  runtime: { interactionP95Ms: number; layoutShift: number; lcpMs: number; routeTransitionResponseMs: number };
};
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Infinity;

async function pageVitals(page: Page) {
  await page.waitForTimeout(750);
  return page.evaluate(() => ({
    cls: ((window as typeof window & { __edgeLayoutShifts?: number[] }).__edgeLayoutShifts ?? []).reduce((total, value) => total + value, 0),
    layoutShifts: (window as typeof window & { __edgeLayoutShiftDetails?: unknown[] }).__edgeLayoutShiftDetails ?? [],
    lcpMs: (window as typeof window & { __edgeLargestContentfulPaint?: number }).__edgeLargestContentfulPaint ?? 0,
  }));
}

test("representative public and authenticated pages meet release performance budgets", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await installDeterminism(page);
  await seedApprovedSession(page);
  const client = await page.context().newCDPSession(page);
  const reportPath = testInfo.outputPath("page-performance.json");
  const report: Record<string, unknown> = {
    buildSha: process.env.EDGELAB_BUILD_SHA ?? "working-tree",
    device: {
      coreVitalsAndInp: "Chromium 1440×1000, 4× CPU throttle, deterministic fixtures",
      routeTransition: "Chromium 1440×1000, native CPU, deterministic fixtures",
    },
    measuredAt: new Date().toISOString(),
    phase: "collecting",
  };
  let throttled = false;
  try {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    throttled = true;
    await gotoStable(page, "/", { waitForNetworkIdle: false });
    report.public = await pageVitals(page);

    await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
    await expect(page.getByRole("heading", { level: 1, name: "Live markets" })).toBeVisible();
    report.authenticated = await pageVitals(page);

    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    throttled = false;
    const routeDurations: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const [buttonName, heading] = index % 2 === 0 ? ["Replay sessions", "Replay sessions"] : ["Live markets", "Live markets"];
      routeDurations.push(await page.evaluate(async ({ buttonName: targetButton, heading: targetHeading }) => {
        const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim().startsWith(targetButton)
          || candidate.getAttribute("aria-label")?.endsWith(targetButton));
        if (!button) throw new Error(`Route control unavailable: ${targetButton}`);
        const startedAt = performance.now();
        button.click();
        while (![...document.querySelectorAll("h1")].some((candidate) => candidate.textContent?.trim() === targetHeading)) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return performance.now() - startedAt;
      }, { buttonName, heading }));
    }
    report.routeTransitions = routeDurations;
    report.routeTransitionP95Ms = p95(routeDurations);

    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    throttled = true;
    for (let index = 0; index < 20; index += 1) {
      const commandButton = page.getByRole("button", { name: /^(Commands|Open command palette)$/ });
      await commandButton.click();
      await expect(page.getByRole("dialog", { name: "EdgeLab command palette" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "EdgeLab command palette" })).toBeHidden();
    }
    const interactions = await page.evaluate(() => {
      const entries = (window as typeof window & { __edgeInteractions?: Array<{ duration: number; interactionId: number }> }).__edgeInteractions ?? [];
      const grouped = new Map<number, number>();
      entries.forEach(({ duration, interactionId }) => grouped.set(interactionId, Math.max(grouped.get(interactionId) ?? 0, duration)));
      return [...grouped.values()];
    });
    report.interactions = interactions;
    report.inpMs = interactions.length ? Math.max(...interactions) : 0;
    report.interactionP95Ms = interactions.length ? p95(interactions) : 0;
  } catch (error) {
    report.collectionError = error instanceof Error ? error.message : String(error);
  } finally {
    report.phase = "complete";
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[page-performance] ${JSON.stringify(report)}`);
    await testInfo.attach("page-performance.json", { contentType: "application/json", path: reportPath });
    if (throttled) await client.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);
    await client.detach().catch(() => undefined);
  }

  const publicVitals = report.public as { cls?: number; lcpMs?: number } | undefined;
  const authenticatedVitals = report.authenticated as { cls?: number; lcpMs?: number } | undefined;
  const interactionSamples = report.interactions as number[] | undefined;
  const failures = [
    report.collectionError ? `collection: ${report.collectionError}` : null,
    Number(publicVitals?.lcpMs) > 0 && Number(publicVitals?.lcpMs) <= budgets.runtime.lcpMs ? null : `public LCP: ${publicVitals?.lcpMs ?? "missing"} > ${budgets.runtime.lcpMs}`,
    Number(authenticatedVitals?.lcpMs) > 0 && Number(authenticatedVitals?.lcpMs) <= budgets.runtime.lcpMs ? null : `authenticated LCP: ${authenticatedVitals?.lcpMs ?? "missing"} > ${budgets.runtime.lcpMs}`,
    Number(publicVitals?.cls) <= budgets.runtime.layoutShift ? null : `public CLS: ${publicVitals?.cls ?? "missing"} > ${budgets.runtime.layoutShift}`,
    Number(authenticatedVitals?.cls) <= budgets.runtime.layoutShift ? null : `authenticated CLS: ${authenticatedVitals?.cls ?? "missing"} > ${budgets.runtime.layoutShift}`,
    (interactionSamples?.length ?? 0) >= 20 ? null : `INP samples: ${interactionSamples?.length ?? 0} < 20`,
    Number(report.inpMs) > 0 && Number(report.inpMs) <= budgets.runtime.interactionP95Ms ? null : `INP: ${report.inpMs ?? "missing"} > ${budgets.runtime.interactionP95Ms}`,
    Number(report.routeTransitionP95Ms) <= budgets.runtime.routeTransitionResponseMs ? null : `route response P95: ${report.routeTransitionP95Ms} > ${budgets.runtime.routeTransitionResponseMs}`,
  ].filter((failure): failure is string => Boolean(failure));
  expect(failures, failures.join("\n")).toEqual([]);
});
