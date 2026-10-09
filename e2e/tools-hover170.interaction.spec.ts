import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { gotoStable, installDeterminism } from "./support/app";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const beforeSeal = seal(), errors = new WeakMap<Page, string[]>();
const preferenceKey = "edgelab.marketing.motion.v1";
test.beforeEach(({ page }) => { errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); expect(seal()).toBe(beforeSeal); });

async function chartState(page: Page) {
  return page.evaluate(async () => {
    const stage = document.querySelector<HTMLElement>(".chart-stage")!;
    const fiberKey = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    let chart: any, series: any;
    for (let fiber = fiberKey ? (stage as any)[fiberKey] : null, depth = 0; fiber && depth < 64; fiber = fiber.return, depth++) {
      for (let hook = fiber.memoizedState, n = 0; hook && n < 384; hook = hook.next, n++) {
        const ref = hook.memoizedState?.current;
        if (typeof ref?.timeScale === "function" && typeof ref?.addCandlestickSeries === "function") chart ??= ref;
        if (typeof ref?.seriesType === "function" && ref.seriesType() === "Candlestick") series ??= ref;
      }
    }
    if (!chart || !series) throw Error("Production live chart unavailable");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { width: chart.paneSize().width, height: stage.getBoundingClientRect().height, range: chart.timeScale().getVisibleLogicalRange(), count: series.data().length };
  });
}
async function stableChartState(page: Page) {
  let previous = "", since = 0;
  await expect.poll(async () => {
    const current = await chartState(page), serialized = JSON.stringify(current);
    if (current.count !== 600 || serialized !== previous) { previous = serialized; since = Date.now(); return false; }
    return Date.now() - since >= 200;
  }, { intervals: [50] }).toBe(true);
  return chartState(page);
}
function unchanged(actual: Awaited<ReturnType<typeof chartState>>, before: Awaited<ReturnType<typeof chartState>>) {
  expect(actual.width).toBe(before.width);
  expect(actual.height).toBe(before.height);
  expect(actual.count).toBe(before.count);
  expect(actual.range.from).toBeCloseTo(before.range.from, 7);
  expect(actual.range.to).toBeCloseTo(before.range.to, 7);
}
async function leaveTools(page: Page) {
  const box = await page.locator(".chart-stage").first().boundingBox();
  await page.mouse.move(box!.x + 20, box!.y + Math.min(100, box!.height / 2), { steps: 8 });
}
async function capture(page: Page, info: TestInfo, name: string, data: unknown) {
  const directory = path.resolve(".artifacts/tools-hover175", info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name + ".json"), JSON.stringify({ data, errors: errors.get(page), distSeal: beforeSeal }, null, 2));
  await page.screenshot({ path: path.join(directory, name + ".png"), animations: "allow" });
}

test("desktop Tools hover overlays without chart resize; pointer continuity, pin and collapse remain usable", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  const fixture = await liveViewportSetup(page);
  await expect.poll(async () => (await chartState(page)).count).toBe(600);
  const trigger = page.locator('[data-motion="workspace-panel-trigger"]');
  const pane = page.getByRole("complementary", { name: "Chart tools", exact: true });
  await expect(trigger).toBeVisible();
  await leaveTools(page);
  await page.locator("#workspace-content").focus();
  await expect(pane).toHaveCount(0);
  const before = await stableChartState(page);
  const savedBefore = JSON.stringify(fixture.storage.get("journal-panel-layout.v1") ?? null);

  await trigger.hover();
  await expect(pane).toBeVisible();
  await expect(pane).toHaveAttribute("data-hover-preview", "true");
  unchanged(await chartState(page), before);
  const box = await pane.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 80, { steps: 12 });
  await expect(pane).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  unchanged(await chartState(page), before);
  expect(JSON.stringify(fixture.storage.get("journal-panel-layout.v1") ?? null)).toBe(savedBefore);
  await capture(page, info, "tools-hover-overlay", { before, preview: await chartState(page), savedBefore });
  await leaveTools(page);
  await expect(pane).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  unchanged(await chartState(page), before);

  // A touch/pen pointer crossing never opts in to the mouse-only preview.
  for (const pointerType of ["touch", "pen"]) {
    await trigger.dispatchEvent("pointerover", { pointerType, bubbles: true });
    await expect(pane).toHaveCount(0);
    await trigger.dispatchEvent("pointerout", { pointerType, bubbles: true });
  }
  await trigger.hover();
  await expect(pane).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveCount(0);
  await expect(pane).not.toHaveAttribute("data-hover-preview", "true");
  await expect(pane.getByRole("tab", { selected: true })).toBeFocused();
  await leaveTools(page);
  await expect(pane).toBeVisible();
  await expect.poll(() => fixture.storage.get("journal-panel-layout.v1")?.collapsed).toBe(false);
  await pane.getByRole("button", { name: "Collapse workspace panel", exact: true }).click();
  await expect(pane).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await leaveTools(page);
  await page.locator("#workspace-content").focus();
  await expect.poll(() => fixture.storage.get("journal-panel-layout.v1")?.collapsed).toBe(true);
  await trigger.hover();
  await expect(pane).toBeVisible();
  await page.getByRole("button", { name: "Keep workspace panel open", exact: true }).click();
  await expect(pane.getByRole("tab", { selected: true })).toBeFocused();
  await leaveTools(page);
  await expect(pane).toBeVisible();
  await expect(trigger).toHaveCount(0);
  await pane.getByRole("button", { name: "Collapse workspace panel", exact: true }).click();
  await expect(pane).toHaveCount(0);
  await leaveTools(page);
  await page.locator("#workspace-content").focus();
  await trigger.hover();
  await expect(pane).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Escape");
  await expect(pane).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const final = await chartState(page);
  expect(final.width).toBe(before.width);
  expect(final.height).toBe(before.height);
  expect(final.count).toBe(before.count);
  expect(fixture.events).toEqual([]);
  await capture(page, info, "tools-collapsed", { before, final: await chartState(page), saved: fixture.storage.get("journal-panel-layout.v1") });
});

test("short desktop hover fits the viewport and keyboard focus holds the preview until focus leaves", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.setViewportSize({ width: 1280, height: 600 });
  const fixture = await liveViewportSetup(page);
  const trigger = page.locator('[data-motion="workspace-panel-trigger"]');
  const pane = page.getByRole("complementary", { name: "Chart tools", exact: true });
  await leaveTools(page);
  await page.locator("#workspace-content").focus();
  const before = await stableChartState(page);
  await trigger.hover();
  await expect(pane).toBeVisible();
  const box = await pane.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(592.01);
  expect(box!.height).toBeGreaterThan(48);
  expect(await pane.evaluate(node => getComputedStyle(node).minHeight)).toBe("0px");
  unchanged(await chartState(page), before);
  const tab = pane.getByRole("tab", { selected: true });
  await tab.focus();
  await leaveTools(page);
  await expect(pane).toBeVisible();
  await expect(tab).toBeFocused();
  unchanged(await chartState(page), before);
  await capture(page, info, "tools-short-keyboard", { before, box, preview: await chartState(page) });
  await page.locator("#workspace-content").focus();
  await expect(pane).toHaveCount(0);
  await trigger.hover();
  await expect(pane).toBeVisible();
  for (const width of [1279, 1024]) {
    await page.setViewportSize({ width, height: 600 });
    await leaveTools(page);
    await page.locator("#workspace-content").focus();
    await expect(pane).toHaveCount(0);
    const resized = await stableChartState(page);
    const savedBefore = JSON.stringify(fixture.storage.get("journal-panel-layout.v1") ?? null);
    await trigger.hover();
    await expect(pane).toBeVisible();
    await expect(pane).toHaveAttribute("data-hover-preview", "true");
    const previewBox = await pane.boundingBox();
    expect(previewBox!.x).toBeGreaterThanOrEqual(0);
    expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(width + .01);
    expect(previewBox!.y).toBeGreaterThanOrEqual(0);
    expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(592.01);
    expect(previewBox!.height).toBeGreaterThan(48);
    expect(await pane.evaluate(node => getComputedStyle(node).minHeight)).toBe("0px");
    const preview = await chartState(page); unchanged(preview, resized);
    expect(JSON.stringify(fixture.storage.get("journal-panel-layout.v1") ?? null)).toBe(savedBefore);
    await capture(page, info, `tools-breakpoint-${width}`, { before: resized, preview, box: previewBox, savedBefore });
    await leaveTools(page);
    await expect(pane).toHaveCount(0);
    unchanged(await chartState(page), resized);
  }
  // Exercise the largest actual preference in the smallest hover-enabled
  // viewport, with the real navigation pinned to its expanded width.
  await page.mouse.move(30, 300);
  await page.getByRole("button", { name: "Keep workspace navigation expanded", exact: true }).click();
  const navigation = page.getByRole("complementary", { name: "Workspace navigation", exact: true });
  await expect.poll(() => navigation.evaluate(node => node.getBoundingClientRect().width)).toBe(252);
  await page.locator("#workspace-content").focus();
  await trigger.hover();
  await expect(pane).toBeVisible();
  await pane.getByRole("button", { name: "Expand workspace panel", exact: true }).click();
  const resize = pane.getByRole("separator", { name: "Resize Chart tools", exact: true });
  await resize.focus();
  for (let step = 0; Number(await resize.getAttribute("aria-valuenow")) < 720 && step < 20; step++) await resize.press("ArrowLeft");
  await expect(resize).toHaveAttribute("aria-valuenow", "720");
  for (const dock of ["right", "left"]) {
    if (dock === "left") {
      await trigger.hover();
      await expect(pane).toBeVisible();
      await pane.getByRole("button", { name: "Dock workspace panel to left", exact: true }).click();
      await expect(pane).toHaveAttribute("data-dock", "left");
    }
    await page.mouse.move(1, 1);
    await page.locator("#workspace-content").focus();
    await expect(pane).toHaveCount(0);
    const expandedBefore = await stableChartState(page);
    await trigger.hover();
    await expect(pane).toHaveAttribute("data-hover-preview", "true");
    await expect(pane).toHaveAttribute("data-dock", dock);
    await expect(pane).toHaveAttribute("data-mode", "expanded");
    const expandedBox = await pane.boundingBox();
    expect(expandedBox!.width).toBe(720);
    expect(expandedBox!.x).toBeGreaterThanOrEqual(0);
    expect(expandedBox!.x + expandedBox!.width).toBeLessThanOrEqual(1024.01);
    expect(expandedBox!.y).toBeGreaterThanOrEqual(0);
    expect(expandedBox!.y + expandedBox!.height).toBeLessThanOrEqual(592.01);
    const expandedPreview = await chartState(page); unchanged(expandedPreview, expandedBefore);
    expect(await navigation.evaluate(node => node.getBoundingClientRect().width)).toBe(252);
    await expect.poll(() => fixture.storage.get("journal-panel-layout.v1")?.collapsed).toBe(true);
    await capture(page, info, `tools-1024-expanded-${dock}`, { before: expandedBefore, preview: expandedPreview, box: expandedBox, sidebarWidth: 252, width: 720, dock });
    await page.mouse.move(1, 1);
    await page.locator("#workspace-content").focus();
    await expect(pane).toHaveCount(0);
    unchanged(await chartState(page), expandedBefore);
  }
  await page.setViewportSize({ width: 1023, height: 600 });
  await expect(pane).toHaveCount(0);
  await leaveTools(page);
  await page.locator("#workspace-content").focus();
  const narrow = await stableChartState(page);
  await trigger.hover();
  await expect(pane).toHaveCount(0);
  unchanged(await chartState(page), narrow);
  await capture(page, info, "tools-below-breakpoint-1023", { before: narrow, final: await chartState(page) });
  expect(fixture.events).toEqual([]);
});

test("mobile Tools has no hover preview and opens and closes by touch", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  const fixture = await liveViewportSetup(page);
  const trigger = page.locator('[data-motion="workspace-panel-trigger"]');
  const pane = page.getByRole("complementary", { name: "Chart tools", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.dispatchEvent("pointerover", { pointerType: "touch", bubbles: true });
  await expect(pane).toHaveCount(0);
  await trigger.tap();
  await expect(pane).toBeVisible();
  await expect(pane).not.toHaveAttribute("data-hover-preview", "true");
  await expect(trigger).toHaveCount(0);
  await capture(page, info, "tools-touch-open", { saved: fixture.storage.get("journal-panel-layout.v1") });
  await pane.getByRole("button", { name: "Collapse workspace panel", exact: true }).tap();
  await expect(pane).toHaveCount(0);
  await expect(trigger).toBeVisible();
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(fixture.events).toEqual([]);
  await capture(page, info, "tools-touch-collapsed", await chartState(page));
});

async function center(target: Locator) {
  await target.evaluate(node => { const rect = node.getBoundingClientRect(); window.scrollTo({ top: scrollY + rect.top + rect.height / 2 - innerHeight / 2, behavior: "instant" }); });
}
async function candles(hero: Locator) {
  return hero.locator("canvas").first().evaluate(node => {
    for (let element: Element | null = node; element; element = element.parentElement) {
      const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
      for (let fiber = key ? (element as any)[key] : null, depth = 0; fiber && depth < 30; fiber = fiber.return, depth++) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const current = hook.memoizedState?.current;
          if (typeof current?.seriesType === "function" && current.seriesType() === "Candlestick") return current.data().map((bar: any) => ({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close }));
        }
      }
    }
    throw Error("Actual landing Candlestick series unavailable");
  }) as Promise<Array<{ time: number; open: number; high: number; low: number; close: number }>>;
}
test("footer Pause animations freezes real hero candles and resumes them when cleared", async ({ page }, info) => {
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/billing/catalog", route => route.fulfill({ json: {
    provider: "stripe", enabled: false, mode: "live", checkout_available: false, reason: "Billing is not configured.",
    plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
  } }));
  await gotoStable(page, "/");
  const root = page.locator("[data-marketing-motion]").first(), hero = page.locator("[data-landing-stage]");
  const state = hero.locator("[data-replay-cursor]"), pause = page.getByRole("checkbox", { name: "Pause animations", exact: true });
  await expect(page.getByRole("checkbox", { name: "Reduce motion", exact: true })).toHaveCount(0);
  await center(hero.locator("canvas").first());
  await expect(state).toHaveAttribute("data-market-following", "true");
  const initial = Number(await state.getAttribute("data-market-last-index"));
  await expect.poll(async () => Number(await state.getAttribute("data-market-last-index"))).toBeGreaterThan(initial + 4);
  await pause.check();
  await expect(root).toHaveAttribute("data-marketing-motion", "reduced");
  expect(await page.evaluate(key => sessionStorage.getItem(key), preferenceKey)).toBe("reduced");
  await capture(page, info, "footer-paused", { preference: "reduced" });
  await center(hero.locator("canvas").first());
  await expect(state).toHaveAttribute("data-market-following", "false");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const pausedIndex = await state.getAttribute("data-market-last-index"), paused = await candles(hero);
  // More than four genuine 280ms interval opportunities prove the loop is stopped.
  await page.waitForTimeout(1200);
  expect(await state.getAttribute("data-market-last-index")).toBe(pausedIndex);
  expect(await candles(hero)).toEqual(paused);
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
  await capture(page, info, "hero-paused", { pausedIndex, paused });
  await pause.uncheck();
  await expect(root).toHaveAttribute("data-marketing-motion", "full");
  expect(await page.evaluate(key => sessionStorage.getItem(key), preferenceKey)).toBe("full");
  await center(hero.locator("canvas").first());
  await expect(state).toHaveAttribute("data-market-following", "true");
  await expect.poll(async () => Number(await state.getAttribute("data-market-last-index"))).toBeGreaterThan(Number(pausedIndex) + 4);
  const resumed = await candles(hero);
  expect(resumed.at(-1)!.time).toBeGreaterThan(paused.at(-1)!.time);
  expect(resumed.length).toBeGreaterThanOrEqual(16);
  expect(resumed.length).toBeLessThanOrEqual(160);
  await capture(page, info, "hero-resumed", { pausedIndex, resumedIndex: await state.getAttribute("data-market-last-index"), resumed });
});
