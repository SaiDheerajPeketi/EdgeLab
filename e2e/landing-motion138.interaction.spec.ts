import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { gotoStable, installDeterminism } from "./support/app";

const artifacts = path.resolve(".artifacts/landing-motion138");
const preferenceKey = "edgelab.marketing.motion.v1";
const errors = new WeakMap<Page, string[]>();

async function openLanding(page: Page, reducedMotion: "reduce" | "no-preference") {
  // HTTP-only setup: retain production GSAP, observers, timers, charts and real time.
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  await page.emulateMedia({ reducedMotion });
  await page.route("**/api/billing/catalog", route => route.fulfill({ json: {
    provider: "stripe", enabled: false, mode: "live", checkout_available: false,
    reason: "Billing is not configured.",
    plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
  } }));
  await gotoStable(page, "/");
  await expect(page.locator("[data-marketing-motion]").first()).toBeVisible();
}

async function center(page: Page, target: Locator) {
  await target.evaluate(node => {
    const rect = node.getBoundingClientRect();
    window.scrollTo({ top: scrollY + rect.top + rect.height / 2 - innerHeight / 2, behavior: "instant" });
  });
}

async function motion(target: Locator) {
  return target.evaluate(node => {
    let effectiveOpacity = 1;
    let owners = 0;
    for (let current: HTMLElement | null = node as HTMLElement; current; current = current.parentElement) {
      effectiveOpacity *= Number(getComputedStyle(current).opacity);
      if (current.style.opacity !== "" && current.style.transform !== "") owners++;
    }
    const style = getComputedStyle(node);
    const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    return { effectiveOpacity, x: matrix.m41, y: matrix.m42, owners };
  });
}

async function settled(target: Locator) {
  // Finite motion must finish while the viewport is stationary, without scrub.
  await target.page().waitForTimeout(1500);
  const first = await motion(target);
  await target.page().waitForTimeout(250);
  const second = await motion(target);
  for (const key of ["effectiveOpacity", "x", "y"] as const) {
    expect(Math.abs(first[key] - second[key])).toBeLessThan(0.01);
  }
  return second;
}

async function candles(hero: Locator) {
  return hero.locator("canvas").first().evaluate(node => {
    // Read the genuine production series only; do not replace any chart API or output.
    for (let element: Element | null = node; element; element = element.parentElement) {
      const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
      let fiber = key ? (element as any)[key] : null;
      for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const current = hook.memoizedState?.current;
          if (current && typeof current.seriesType === "function" && current.seriesType() === "Candlestick") {
            return current.data().map((bar: any) => ({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close }));
          }
        }
      }
    }
    throw new Error("Actual landing Candlestick series unavailable.");
  }) as Promise<Array<{ time: number; open: number; high: number; low: number; close: number }>>;
}

async function advancing(page: Page, hero: Locator) {
  await center(page, hero.locator("canvas").first());
  const state = hero.locator("[data-replay-cursor]");
  await expect(state).toHaveAttribute("data-market-following", "true");
  const initialIndex = Number(await state.getAttribute("data-market-last-index"));
  const initial = await candles(hero);
  await expect.poll(async () => Number(await state.getAttribute("data-market-last-index"))).toBeGreaterThan(initialIndex + 4);
  const final = await candles(hero);
  expect(final.length).toBeGreaterThanOrEqual(64);
  expect(final.at(-1)!.time).toBeGreaterThan(initial.at(-1)!.time);
  const original = new Map(initial.map(bar => [bar.time, bar]));
  for (const bar of final) if (original.has(bar.time)) expect(bar).toEqual(original.get(bar.time));
  for (let i = 1; i < final.length; i++) expect(final[i].time - final[i - 1].time).toBe(300);
  return { initialIndex, finalIndex: Number(await state.getAttribute("data-market-last-index")), initial, final };
}

async function frozen(hero: Locator) {
  const state = hero.locator("[data-replay-cursor]");
  await expect(state).toHaveAttribute("data-market-following", "false");
  // Let the native effect cleanup finish before recording an exact frozen snapshot.
  await hero.page().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const index = await state.getAttribute("data-market-last-index");
  const bars = await candles(hero);
  await hero.page().waitForTimeout(1200);
  expect(await state.getAttribute("data-market-last-index")).toBe(index);
  expect(await candles(hero)).toEqual(bars);
  return { index, bars };
}

async function savedChoice(page: Page, value: "full" | "reduced") {
  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), preferenceKey)).toBe(value);
}

async function capture(page: Page, info: TestInfo, name: string, data: unknown) {
  const directory = path.join(artifacts, info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  const json = path.join(directory, `${name}.json`);
  fs.writeFileSync(json, JSON.stringify(data, null, 2));
  await info.attach(name, { path: json, contentType: "application/json" });
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: "allow" });
}

async function publicCopy(page: Page) {
  const copy = await page.locator("main").innerText();
  expect(copy).not.toMatch(/qualified data required|provider dependent|compatibility beta|future capability|features? to be implemented|implementation timeline|roadmap|coming soon/i);
  return copy;
}

test.beforeEach(({ page }) => {
  const recorded: string[] = [];
  errors.set(page, recorded);
  page.on("pageerror", error => recorded.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test("visitor enables motion under OS reduction, finishes scroll flow, pauses safely and preserves tab choice", async ({ page }, info) => {
  await openLanding(page, "reduce");
  const root = page.locator("[data-marketing-motion]").first();
  const hero = page.locator("[data-landing-stage]");
  await expect(root).toHaveAttribute("data-marketing-motion", "reduced");
  expect(await page.evaluate(key => sessionStorage.getItem(key), preferenceKey)).toBeNull();
  await center(page, hero.locator("canvas").first());
  const defaultFrozen = await frozen(hero);
  await expect(hero.getByRole("button", { name: /^(Play|Pause) replay$/ })).toBeDisabled();

  const enable = page.getByRole("button", { name: "Enable animations", exact: true });
  await expect(enable).toBeVisible();
  const buttonBox = await enable.boundingBox();
  expect(buttonBox!.width).toBeGreaterThanOrEqual(44);
  expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
  await enable.click();
  await expect(root).toHaveAttribute("data-marketing-motion", "full");
  await savedChoice(page, "full");
  await expect.poll(() => page.evaluate(() => typeof (window as any).gsap?.to)).toBe("function");
  const firstRun = await advancing(page, hero);
  await capture(page, info, "enabled-hero", { defaultFrozen, firstRun, buttonBox });

  const flow = [];
  for (const row of [page.locator("[data-flow-row]").first(), page.locator("#capabilities article").first(), page.locator("#evidence article").first()]) {
    await center(page, row);
    const entered = await settled(row);
    expect(entered.effectiveOpacity).toBeCloseTo(1, 2);
    expect(entered.y).toBeCloseTo(0, 2);
    expect((await motion(row.locator("h3"))).owners).toBe(1);
    await page.locator("#faq").scrollIntoViewIfNeeded();
    const exited = await settled(row);
    expect(exited.effectiveOpacity).toBeCloseTo(0, 2);
    await center(page, row);
    const returned = await settled(row);
    expect(returned.effectiveOpacity).toBeCloseTo(1, 2);
    expect(returned.y).toBeCloseTo(0, 2);
    expect((await motion(row.locator("h3"))).owners).toBe(1);
    flow.push({ title: await row.locator("h3").innerText(), entered, exited, returned });
  }
  await capture(page, info, "enabled-flow", { flow });

  await center(page, hero.locator("canvas").first());
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  await expect(root).toHaveAttribute("data-marketing-motion", "reduced");
  await savedChoice(page, "reduced");
  const visitorFrozen = await frozen(hero);
  const workflow = page.locator("[data-flow-row]").first();
  const readable = await settled(workflow);
  expect(readable.effectiveOpacity).toBe(1);
  expect(readable.y).toBe(0);
  await capture(page, info, "paused-hero", { visitorFrozen, readable, copy: await publicCopy(page) });

  await page.getByRole("button", { name: "Enable animations", exact: true }).click();
  await advancing(page, hero);
  await hero.getByRole("button", { name: "Pause replay", exact: true }).click();
  const manualFrozen = await frozen(hero);
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  await page.getByRole("button", { name: "Enable animations", exact: true }).click();
  await expect(hero.getByRole("button", { name: "Play replay", exact: true })).toBeEnabled();
  expect((await frozen(hero)).index).toBe(manualFrozen.index);
  await hero.getByRole("button", { name: "Play replay", exact: true }).click();
  await advancing(page, hero);

  await page.reload();
  await expect(root).toHaveAttribute("data-marketing-motion", "full");
  await savedChoice(page, "full");
  const reloadRun = await advancing(page, hero);
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  await page.reload();
  await expect(root).toHaveAttribute("data-marketing-motion", "reduced");
  await savedChoice(page, "reduced");
  await center(page, hero.locator("canvas").first());
  const reloadFrozen = await frozen(hero);
  await capture(page, info, "tab-choice", { manualFrozen, reloadRun, reloadFrozen });
});

test("system defaults retain continuous playback and visibility gates until a visitor chooses otherwise", async ({ page }, info) => {
  await openLanding(page, "no-preference");
  const root = page.locator("[data-marketing-motion]").first();
  const hero = page.locator("[data-landing-stage]");
  await expect(root).toHaveAttribute("data-marketing-motion", "full");
  expect(await page.evaluate(key => sessionStorage.getItem(key), preferenceKey)).toBeNull();
  const initial = await advancing(page, hero);
  const following = await advancing(page, hero);
  expect(following.finalIndex).toBeGreaterThan(initial.finalIndex);
  await page.locator("#faq").scrollIntoViewIfNeeded();
  const offscreen = await frozen(hero);
  const resumed = await advancing(page, hero);
  expect(resumed.finalIndex).toBeGreaterThan(Number(offscreen.index));

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(root).toHaveAttribute("data-marketing-motion", "reduced");
  const systemFrozen = await frozen(hero);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(root).toHaveAttribute("data-marketing-motion", "full");
  const systemResumed = await advancing(page, hero);
  await capture(page, info, "system-default", { initial, following, offscreen, resumed, systemFrozen, systemResumed, copy: await publicCopy(page) });
});
