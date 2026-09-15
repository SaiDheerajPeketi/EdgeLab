import { expect, test } from "@playwright/test";
import {
  gotoStable,
  installDeterminism,
  seedApprovedSession,
} from "./support/app";

declare global {
  interface Window {
    __edgelabMotionIntervalCounts?: Record<string, number>;
  }
}

test("a live reduced-motion preference stops repeated landing work", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The motion preference contract is viewport-independent.");
  await installDeterminism(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.__edgelabMotionIntervalCounts = {};
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const delay = String(timeout ?? 0);
      return nativeSetInterval(() => {
        const counts = window.__edgelabMotionIntervalCounts ?? {};
        counts[delay] = (counts[delay] ?? 0) + 1;
        window.__edgelabMotionIntervalCounts = counts;
        if (typeof handler === "function") {
          Reflect.apply(handler, window, args);
        } else {
          window.eval(handler);
        }
      }, timeout);
    }) as typeof window.setInterval;
  });
  await gotoStable(page, "/");

  const intervalCounts = () => page.evaluate(() => ({ ...window.__edgelabMotionIntervalCounts }));
  await expect.poll(async () => (await intervalCounts())["280"] ?? 0).toBeGreaterThan(0);
  await expect.poll(async () => (await intervalCounts())["1600"] ?? 0).toBeGreaterThan(0);

  const repeatedAnimationViolations = await page.evaluate(() => {
    const metadataKeys = new Set(["composite", "computedOffset", "easing", "offset"]);
    return document.getAnimations().flatMap((animation) => {
      const effect = animation.effect;
      if (!(effect instanceof KeyframeEffect) || effect.getTiming().iterations !== Number.POSITIVE_INFINITY) {
        return [];
      }
      const unsafeProperties = [...new Set(effect.getKeyframes().flatMap((frame) => Object.keys(frame)))]
        .filter((property) => !metadataKeys.has(property) && property !== "opacity" && property !== "transform");
      return unsafeProperties.length === 0
        ? []
        : [{ name: animation instanceof CSSAnimation ? animation.animationName : "scripted", unsafeProperties }];
    });
  });
  expect(repeatedAnimationViolations).toEqual([]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await expect(page.locator(".edgelab-marquee")).toHaveCSS("animation-name", "none");
  await page.waitForTimeout(150);
  const stoppedCounts = await intervalCounts();
  const stoppedMotionCounts = {
    heroAutoplay: stoppedCounts["280"] ?? 0,
    marketTicker: stoppedCounts["1600"] ?? 0,
  };
  await page.waitForTimeout(1_900);
  const finalCounts = await intervalCounts();
  expect({
    heroAutoplay: finalCounts["280"] ?? 0,
    marketTicker: finalCounts["1600"] ?? 0,
  }).toEqual(stoppedMotionCounts);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);

  await expect(page.getByRole("heading", { name: "Replay the market. Preserve the decision." })).toBeVisible();
  const journalStep = page.locator('[data-scenario-pill="true"]').filter({ hasText: "02 · Journal" });
  await journalStep.click();
  await expect(journalStep).toHaveAttribute("aria-current", "step");
});

test("the reduced-motion circular toolbox remains keyboard-usable and restores focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The circular toolbox keyboard contract is checked once.");
  await installDeterminism(page);
  await seedApprovedSession(page);
  await gotoStable(page, "/app/live", { waitForNetworkIdle: false });

  const chart = page.getByRole("region", { name: /chart/i }).first();
  await chart.focus();
  await page.keyboard.down("Alt");
  const toolbox = page.getByRole("menu", { name: "Circular drawing toolbox" });
  await expect(toolbox).toBeVisible();
  await expect(toolbox).toHaveCSS("animation-name", "none");
  const tools = toolbox.getByRole("menuitem");
  expect(await tools.count()).toBeGreaterThan(0);
  await expect(tools.first()).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("1");
  await expect(toolbox).toBeHidden();
  await page.keyboard.up("Alt");
  await expect(chart).toBeFocused();

  await page.keyboard.down("Alt");
  await expect(toolbox).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.up("Alt");
  await expect(toolbox).toBeHidden();
  await expect(chart).toBeFocused();
});
