import { expect, test } from "@playwright/test";
import {
  certifyUiState,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
} from "./support/app";

declare global {
  interface Window {
    __edgelabMotionIntervalCounts?: Record<string, number>;
    __edgelabMotionIntervalIds?: Record<string, number[]>;
    __edgelabIntersectionDisconnects?: number;
  }
}

test("a live reduced-motion preference stops repeated landing work", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The motion preference contract is viewport-independent.");
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.__edgelabMotionIntervalCounts = {};
    window.__edgelabMotionIntervalIds = {};
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const delay = String(timeout ?? 0);
      const intervalId = nativeSetInterval(() => {
        const counts = window.__edgelabMotionIntervalCounts ?? {};
        counts[delay] = (counts[delay] ?? 0) + 1;
        window.__edgelabMotionIntervalCounts = counts;
        if (typeof handler === "function") {
          Reflect.apply(handler, window, args);
        } else {
          window.eval(handler);
        }
      }, timeout);
      const intervalIds = window.__edgelabMotionIntervalIds ?? {};
      intervalIds[delay] = [...(intervalIds[delay] ?? []), intervalId];
      window.__edgelabMotionIntervalIds = intervalIds;
      return intervalId;
    }) as typeof window.setInterval;
  });
  await page.addInitScript(() => {
    const NativeIntersectionObserver = window.IntersectionObserver;
    window.__edgelabIntersectionDisconnects = 0;
    window.IntersectionObserver = class extends NativeIntersectionObserver {
      disconnect() {
        window.__edgelabIntersectionDisconnects = (window.__edgelabIntersectionDisconnects ?? 0) + 1;
        super.disconnect();
      }
    };
  });
  await gotoStable(page, "/");

  const intervalCounts = () => page.evaluate(() => ({ ...window.__edgelabMotionIntervalCounts }));
  const hero = page.locator("[data-market-following]");
  await hero.scrollIntoViewIfNeeded();
  await expect(hero).toHaveAttribute("data-market-following", "true");
  await expect.poll(async () => (await intervalCounts())["280"] ?? 0).toBeGreaterThan(0);
  const firstMarketTime = Number(await hero.getAttribute("data-market-last-time"));
  expect(Number.isFinite(firstMarketTime)).toBe(true);
  expect(firstMarketTime).toBeGreaterThan(0);
  await expect.poll(async () => Number(await hero.getAttribute("data-market-last-time"))).toBeGreaterThan(firstMarketTime);

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

  await page.evaluate(() => window.scrollTo({ behavior: "instant", top: document.documentElement.scrollHeight }));
  await expect(hero).toHaveAttribute("data-market-following", "false");
  await page.waitForTimeout(150);
  const offscreenCounts = await intervalCounts();
  const pausedMotionCounts = {
    heroAutoplay: offscreenCounts["280"] ?? 0,
  };
  const pausedMarketTime = await hero.getAttribute("data-market-last-time");
  await page.waitForTimeout(1_900);
  const afterOffscreenWait = await intervalCounts();
  expect({
    heroAutoplay: afterOffscreenWait["280"] ?? 0,
  }).toEqual(pausedMotionCounts);
  expect(await hero.getAttribute("data-market-last-time")).toBe(pausedMarketTime);

  await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "edgelab-marquee edgelab-marquee-active";
    probe.id = "motion-layout-probe";
    probe.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none";
    probe.textContent = "motion layout probe";
    document.body.appendChild(probe);
  });
  const probe = page.locator("#motion-layout-probe");
  await expect(probe).toHaveCSS("animation-play-state", "running");
  expect(await probe.evaluate((element) => parseFloat(getComputedStyle(element).animationDuration))).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const performanceSession = await page.context().newCDPSession(page);
  await performanceSession.send("Performance.enable");
  const readLayoutCount = async () => {
    const { metrics } = await performanceSession.send("Performance.getMetrics");
    return metrics.find((metric) => metric.name === "LayoutCount")?.value ?? Number.NaN;
  };
  const layoutCountBefore = await readLayoutCount();
  await page.waitForTimeout(750);
  const layoutCountAfter = await readLayoutCount();
  expect(Number.isFinite(layoutCountBefore)).toBe(true);
  expect(layoutCountAfter - layoutCountBefore).toBe(0);
  await performanceSession.detach();

  await hero.scrollIntoViewIfNeeded();
  await expect(hero).toHaveAttribute("data-market-following", "true");
  await expect.poll(async () => (await intervalCounts())["280"] ?? 0).toBeGreaterThan(pausedMotionCounts.heroAutoplay);
  await expect.poll(async () => Number(await hero.getAttribute("data-market-last-time"))).toBeGreaterThan(Number(pausedMarketTime));

  const workflow = page.getByLabel("Trading workspace examples");
  const reviewStep = workflow.getByRole("button", { name: "Journal + review", exact: true });
  const resultsStep = workflow.getByRole("button", { name: "Results", exact: true });
  const replayStep = workflow.getByRole("button", { name: "Replay", exact: true });
  await reviewStep.click();
  await resultsStep.click();
  await reviewStep.click();
  await resultsStep.click();
  await expect(resultsStep).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { name: "Results that still trace back to the session" })).toBeVisible();
  const stage = workflow.locator("xpath=../following-sibling::div[1]");
  await expect.poll(() => stage.evaluate((element) => `${(element as HTMLElement).style.opacity}|${(element as HTMLElement).style.transform}`)).toBe("|");
  const stableStageStyle = await stage.getAttribute("style");
  await page.waitForTimeout(250);
  expect(await stage.getAttribute("style")).toBe(stableStageStyle);

  await replayStep.click();
  await expect(replayStep).toHaveAttribute("aria-current", "step");
  await expect(hero).toHaveAttribute("data-market-following", "true");
  const runningCounts = await intervalCounts();
  await expect.poll(async () => (await intervalCounts())["280"] ?? 0).toBeGreaterThan(runningCounts["280"] ?? 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await expect(page.locator("[data-marketing-motion]")).toHaveAttribute("data-marketing-motion", "reduced");
  await expect(hero).toHaveAttribute("data-market-following", "false");
  await expect(probe).toHaveCSS("animation-name", "none");
  await probe.evaluate((element) => element.remove());
  await page.waitForTimeout(150);
  const stoppedCounts = await intervalCounts();
  const stoppedMotionCounts = {
    heroAutoplay: stoppedCounts["280"] ?? 0,
  };
  const stoppedMarketTime = await hero.getAttribute("data-market-last-time");
  await page.waitForTimeout(1_900);
  const finalCounts = await intervalCounts();
  expect({
    heroAutoplay: finalCounts["280"] ?? 0,
  }).toEqual(stoppedMotionCounts);
  expect(await hero.getAttribute("data-market-last-time")).toBe(stoppedMarketTime);
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);

  await expect(page.getByRole("heading", { name: "Replay the market. Preserve the decision." })).toBeVisible();
  const journalStep = workflow.getByRole("button", { name: "Journal + review", exact: true });
  await journalStep.click();
  await expect(journalStep).toHaveAttribute("aria-current", "step");

  const motionPreference = page.getByRole("checkbox", { name: "Pause animations", exact: true });
  await motionPreference.scrollIntoViewIfNeeded();
  await expect(motionPreference).toBeChecked();
  await motionPreference.uncheck();
  await expect(page.locator("[data-marketing-motion]")).toHaveAttribute("data-marketing-motion", "full");
  await hero.scrollIntoViewIfNeeded();
  await replayStep.click();
  await expect(hero).toHaveAttribute("data-market-following", "true");
  await expect.poll(async () => (await intervalCounts())["280"] ?? 0).toBeGreaterThan(stoppedMotionCounts.heroAutoplay);
  await expect.poll(async () => Number(await hero.getAttribute("data-market-last-time"))).toBeGreaterThan(Number(stoppedMarketTime));
  const disconnectsBeforeNavigation = await page.evaluate(() => window.__edgelabIntersectionDisconnects ?? 0);

  await page.evaluate(() => {
    history.pushState({}, "", "/pricing");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/pricing$/);
  await expect.poll(() => page.evaluate(() => window.__edgelabIntersectionDisconnects ?? 0)).toBeGreaterThan(disconnectsBeforeNavigation);
  const stoppedAfterNavigation = (await intervalCounts())["280"] ?? 0;
  await page.waitForTimeout(600);
  expect((await intervalCounts())["280"] ?? 0).toBe(stoppedAfterNavigation);
});

test("the reduced-motion circular toolbox remains keyboard-usable and restores focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The circular toolbox keyboard contract is checked once.");
  await installDeterminism(page, { motionLock: false });
  await seedApprovedSession(page);
  await gotoStable(page, "/app/live", { waitForNetworkIdle: false });

  const chart = page.getByRole("region", { name: /chart/i }).first();
  await chart.focus();
  await page.keyboard.down("Alt");
  const toolbox = page.getByRole("toolbar", { name: "Circular drawing toolbox" });
  await expect(toolbox).toBeVisible();
  await expect(toolbox).toHaveCSS("animation-name", "none");
  const tools = toolbox.getByRole("button");
  expect(await tools.count()).toBeGreaterThan(0);
  await expect(tools.first()).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("1");
  await expect(toolbox).toBeHidden();
  await page.keyboard.up("Alt");
  await expect(chart).toBeFocused();

  await page.keyboard.down("Alt");
  await expect(toolbox).toBeVisible();
  await certifyUiState(page);
  await page.keyboard.press("Escape");
  await page.keyboard.up("Alt");
  await expect(toolbox).toBeHidden();
  await expect(chart).toBeFocused();
});

test("authenticated shell journal settings and command palette motion remain bounded", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Representative authenticated motion census runs once.");
  await installDeterminism(page, { motionLock: false });
  await seedApprovedSession(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  for (const path of ["/app", "/app/journal/trades", "/app/settings/global"]) {
    await gotoStable(page, path, { waitForNetworkIdle: false });
    const unsafeRepeated = await page.evaluate(() => {
      const metadata = new Set(["composite", "computedOffset", "easing", "offset"]);
      return document.getAnimations().flatMap((animation) => {
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect) || effect.getTiming().iterations !== Infinity) return [];
        return [...new Set(effect.getKeyframes().flatMap((frame) => Object.keys(frame)))]
          .filter((property) => !metadata.has(property) && property !== "opacity" && property !== "transform");
      });
    });
    expect(unsafeRepeated).toEqual([]);
  }

  await gotoStable(page, "/app/live", { waitForNetworkIdle: false });
  await page.getByRole("tab", { name: "Journal" }).click();
  const journalPanel = page.getByRole("tabpanel", { name: "Journal" });
  await expect(journalPanel).toBeVisible();
  expect(await journalPanel.evaluate((panel) => panel.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length)).toBe(0);

  const trigger = page.getByRole("button", { name: "Open command palette" }).first();
  for (let index = 0; index < 4; index += 1) {
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "EdgeLab command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await expect(page.getByRole("dialog", { name: "EdgeLab command palette" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running" && animation.effect instanceof KeyframeEffect && (animation.effect.target as Element | null)?.closest('[role="dialog"]')).length)).toBe(0);

  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const layoutCount = async () => (await client.send("Performance.getMetrics")).metrics.find((metric) => metric.name === "LayoutCount")?.value ?? NaN;
  const before = await layoutCount();
  await page.waitForTimeout(500);
  expect((await layoutCount()) - before).toBe(0);
  await client.detach();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "EdgeLab command palette" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
