import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { gotoStable, installDeterminism } from "./support/app";

const artifacts = path.resolve(".artifacts/landing-flow142");
const errors = new WeakMap<Page, string[]>();
function distSeal() {
  const root = path.resolve("frontend/dist");
  const entries: Array<{ path: string; sha256: string; bytes: number }> = [];
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else { const bytes = fs.readFileSync(full); entries.push({ path: path.relative(root, full), bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex") }); }
    }
  }
  visit(root); entries.sort((a, b) => a.path.localeCompare(b.path));
  return { files: entries.length, sha256: crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex") };
}
const beforeSeal = distSeal();
async function openLanding(page: Page) {
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const events: unknown[] = [];
    (window as any).__landing142Pointer = events;
    for (const type of ["pointerdown", "mousedown", "focusin", "pointerup", "mouseup", "click"]) {
      document.addEventListener(type, event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest("#faq") && !document.activeElement?.closest("#faq")) return;
        const snapshot = (phase: string) => {
          const button = document.querySelector("#faq button[aria-expanded]");
          const owner = document.querySelector("[data-marketing-reveal='faq-list']");
          const rect = button?.getBoundingClientRect();
          events.push({ type, phase, target: target?.tagName, id: target?.id,
            targetText: target?.textContent?.slice(0, 120), activeId: document.activeElement?.id,
            x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY,
            rect: rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width } : null,
            transform: owner ? getComputedStyle(owner).transform : null,
            expanded: button?.getAttribute("aria-expanded") });
        };
        snapshot("capture"); queueMicrotask(() => snapshot("after-handlers"));
      }, { capture: true, passive: true });
    }
  });
  await page.route("**/api/billing/catalog", route => route.fulfill({ json: {
    provider: "stripe", enabled: false, mode: "live", checkout_available: false,
    reason: "Billing is not configured.",
    plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
  } }));
  await gotoStable(page, "/");
  await expect.poll(() => page.evaluate(() => typeof (window as any).gsap?.to)).toBe("function");
}
async function motion(target: Locator) {
  return target.evaluate(node => {
    let effectiveOpacity = 1, owners = 0;
    for (let current: HTMLElement | null = node as HTMLElement; current; current = current.parentElement) {
      effectiveOpacity *= Number(getComputedStyle(current).opacity);
      if (current.style.opacity !== "" && current.style.transform !== "") owners++;
    }
    const style = getComputedStyle(node);
    const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    const rect = node.getBoundingClientRect();
    return { effectiveOpacity, x: matrix.m41, y: matrix.m42, owners,
      top: rect.top, bottom: rect.bottom, height: rect.height, viewport: innerHeight,
      headerBottom: document.querySelector("header")?.getBoundingClientRect().bottom ?? 0, scrollY };
  });
}
async function settled(target: Locator) {
  await target.page().waitForTimeout(1500);
  const first = await motion(target);
  await target.page().waitForTimeout(180);
  const second = await motion(target);
  for (const key of ["effectiveOpacity", "x", "y", "scrollY"] as const) expect(Math.abs(second[key] - first[key])).toBeLessThan(.01);
  return second;
}
async function position(target: Locator, placement: "below" | "entry" | "center" | "tail") {
  await target.evaluate((node, where) => {
    const rect = node.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform === "none" ? undefined : getComputedStyle(node).transform);
    const authoredTop = rect.top - matrix.m42;
    const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    const desiredTop = where === "below" ? innerHeight * 1.06 : where === "entry" ? innerHeight * .84 :
      where === "tail" ? Math.max(headerBottom + 56, innerHeight * .16) - rect.height : innerHeight * .5 - rect.height * .5;
    window.scrollTo({ top: scrollY + authoredTop - desiredTop, behavior: "instant" });
  }, placement);
}
function visible(state: Awaited<ReturnType<typeof motion>>) {
  expect(state.effectiveOpacity).toBeCloseTo(1, 2); expect(state.y).toBeCloseTo(0, 2);
  expect(state.owners).toBe(1);
}
async function capture(page: Page, info: TestInfo, name: string, evidence: unknown) {
  const directory = path.join(artifacts, info.project.name); fs.mkdirSync(directory, { recursive: true });
  const afterSeal = distSeal(); expect(afterSeal).toEqual(beforeSeal);
  const file = path.join(directory, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ beforeSeal, afterSeal, evidence, pageErrors: errors.get(page),
    qualification: "Actual production GSAP, observers, DOM and Lightweight Charts. HTTP presentation fixtures only; retention uses an exact callback-budget timer scheduling seam with unchanged market callbacks/state, not a real-time throughput benchmark." }, null, 2));
  await info.attach(name, { path: file, contentType: "application/json" });
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: "allow" });
}
async function touchGesture(page: Page, target: Locator, direction: "vertical" | "horizontal") {
  await position(target, "center");
  await settled(target);
  const rect = await target.boundingBox(); expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width * .8, y = rect!.y + rect!.height * .5;
  const beforeY = await page.evaluate(() => scrollY);
  await target.evaluate(node => {
    const rail = node.parentElement!;
    const probe = { events: [] as unknown[], changes: [] as unknown[] };
    (window as any).__landing142Gesture = probe;
    const current = () => [...rail.querySelectorAll("[data-scenario-pill]")].map(button => ({
      text: button.textContent?.trim(), current: button.getAttribute("aria-current"),
    }));
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel", "click"]) {
      rail.addEventListener(type, event => {
        const pointer = event as PointerEvent;
        probe.events.push({ type, time: performance.now(), x: pointer.clientX, y: pointer.clientY,
          target: (event.target as Element)?.closest("button")?.textContent?.trim(), selected: current() });
      }, { passive: true, capture: true });
    }
    new MutationObserver(() => probe.changes.push({ time: performance.now(), selected: current() }))
      .observe(rail, { attributes: true, attributeFilter: ["aria-current"], subtree: true });
  });
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  for (let step = 1; step <= 6; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{
      x: x - (direction === "horizontal" ? step * 10 : 0),
      y: y - (direction === "vertical" ? step * 10 : 0), id: 1, radiusX: 2, radiusY: 2, force: 1,
    }] });
    await page.waitForTimeout(24);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await session.detach();
  await page.waitForTimeout(500);
  return { direction, start: { x, y }, beforeY, afterY: await page.evaluate(() => scrollY),
    ledger: await page.evaluate(() => (window as any).__landing142Gesture),
    input: "Native Chromium touch events on the actual scenario button; no synthetic application handlers." };
}
async function timerBudget(page: Page) {
  await page.addInitScript(() => {
    const nativeInterval = window.setInterval.bind(window);
    const probe = { mode: "normal", remaining: 0, delivered: 0, authoredIntervals: [] as number[] };
    (window as any).__landing142Timer = probe;
    window.setInterval = ((handler: TimerHandler, delay?: number, ...args: any[]) => {
      if (delay !== 280 || typeof handler !== "function") return nativeInterval(handler, delay, ...args);
      probe.authoredIntervals.push(delay);
      let lastDispatch = performance.now();
      // Change scheduling only. Each delivery runs the application's own immutable append callback.
      // An exhausted budget pauses this timer, just as a paused test clock would.
      return nativeInterval(() => {
        const current = performance.now();
        if (probe.mode === "budget") {
          if (probe.remaining === 0) return;
          probe.remaining--;
        } else if (current - lastDispatch < 280) return;
        lastDispatch = current; probe.delivered++; handler(...args);
      }, 4);
    }) as typeof window.setInterval;
  });
}
async function deliver(page: Page, count: number) {
  await page.evaluate(value => { (window as any).__landing142Timer.remaining = value; }, count);
  await page.waitForFunction(() => (window as any).__landing142Timer.remaining === 0, null, { timeout: 30_000, polling: "raf" });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function chart(hero: Locator) {
  return hero.locator("canvas").first().evaluate(node => {
    let series: any = null, chart: any = null;
    for (let element: Element | null = node; element; element = element.parentElement) {
      const key = Object.keys(element).find(value => value.startsWith("__reactFiber$"));
      let fiber = key ? (element as any)[key] : null;
      for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const current = hook.memoizedState?.current;
        if (current?.seriesType?.() === "Candlestick") series ??= current;
        if (typeof current?.timeScale === "function" && typeof current?.chartElement === "function" && current.chartElement().contains(node)) chart ??= current;
      }
    }
    if (!series || !chart) throw new Error("Actual landing chart and Candlestick refs are unavailable.");
    const bars = series.data().map((bar: any) => ({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close }));
    const scale = chart.timeScale();
    return { bars, width: scale.width(), range: scale.getVisibleLogicalRange(), spacing: scale.options().barSpacing,
      firstX: scale.timeToCoordinate(bars[0]?.time), lastX: scale.timeToCoordinate(bars.at(-1)?.time) };
  }) as Promise<{ bars: Array<{ time: number; open: number; high: number; low: number; close: number }>; width: number;
    range: { from: number; to: number }; spacing: number; firstX: number; lastX: number }>;
}
function continuous(snapshot: Awaited<ReturnType<typeof chart>>) {
  const bars = snapshot.bars;
  expect(bars.length).toBeGreaterThanOrEqual(64); expect(bars.length).toBeLessThanOrEqual(256);
  for (let i = 1; i < bars.length; i++) {
    expect(bars[i].time - bars[i - 1].time).toBe(300);
    expect(bars[i].open).toBe(bars[i - 1].close);
  }
  for (const bar of bars) {
    expect([bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)).toBe(true);
    expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
    expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
  }
  expect(snapshot.range.from).toBeGreaterThanOrEqual(-1);
  expect(snapshot.range.to).toBeLessThanOrEqual(bars.length);
  expect(snapshot.firstX).toBeLessThanOrEqual(Math.max(6, snapshot.spacing));
  expect(snapshot.width - snapshot.lastX).toBeLessThanOrEqual(Math.max(6, snapshot.spacing));
}
test.beforeEach(({ page }) => {
  const recorded: string[] = []; errors.set(page, recorded);
  page.on("pageerror", error => recorded.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test("text and components finish stopped entrance, visibly exit forward and reenter backward", async ({ page }, info) => {
  await openLanding(page);
  const observations = [];
  const targets = [page.locator("#how-it-works h2"), page.locator('#how-it-works [data-marketing-reveal$="-body"]'),
    page.locator("[data-flow-row]").first(), page.locator("#capabilities article").first()];
  for (const target of targets) {
    await position(target, "below"); await settled(target);
    await position(target, "entry");
    const entered = await settled(target); visible(entered);
    await position(target, "tail");
    const exited = await settled(target);
    expect(exited.effectiveOpacity).toBeCloseTo(0, 2);
    expect(exited.y).toBeLessThan(0);
    expect(exited.bottom).toBeGreaterThan(exited.headerBottom);
    expect(exited.bottom).toBeLessThan(exited.viewport);
    await position(target, "center");
    const returned = await settled(target); visible(returned);
    observations.push({ text: await target.innerText(), entered, exited, returned });
  }
  const row = page.locator("[data-flow-row]").first();
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await position(row, "center");
  visible(await settled(row));
  const original = page.viewportSize()!;
  await page.setViewportSize({ width: original.width > 600 ? 960 : 460, height: original.height });
  await position(row, "center");
  const resized = await settled(row); visible(resized);
  expect((await motion(row.locator("h3"))).owners).toBe(1);
  expect((await motion(row.locator("[data-flow-content] > p"))).owners).toBe(1);
  await capture(page, info, "visible-directional-flow", { observations, resized });
});

test("late pricing and expanded FAQ stay readable through focus and reduced-motion changes", async ({ page }, info) => {
  await openLanding(page);
  expect(await page.locator("[data-testid='pro-pricing']").count()).toBe(0);
  const pricing = page.locator("[data-marketing-reveal='pricing-cards']");
  await position(pricing, "center");
  await expect(page.locator("[data-testid='pro-pricing']")).toBeVisible();
  const pricingHeading = page.locator("[data-testid='pro-pricing'] h2");
  await position(pricing, "center");
  const late = await settled(pricingHeading); visible(late);
  await page.locator("#faq").scrollIntoViewIfNeeded();
  const button = page.locator("#faq button[aria-expanded]").first();
  await expect(button).toBeVisible(); await button.click();
  await capture(page, info, "faq-pointer-activation", { events: await page.evaluate(() => (window as any).__landing142Pointer),
    expanded: await button.getAttribute("aria-expanded") });
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const answer = page.locator("#faq [role='region']");
  await expect(answer).toBeVisible();
  await position(answer, "center");
  const expanded = await settled(answer); visible(expanded);
  expect(await answer.innerText()).toMatch(/Pro connects|Approved users/);
  const footer = page.locator("[data-marketing-reveal='footer']");
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  expect((await settled(footer)).effectiveOpacity).toBeCloseTo(0, 2);
  const privacy = footer.getByRole("link", { name: "Privacy", exact: true });
  await privacy.evaluate(node => (node as HTMLElement).focus({ preventScroll: true }));
  await expect(privacy).toBeFocused(); visible(await settled(footer));
  await page.keyboard.press("Tab");
  expect(await footer.evaluate(node => node.contains(document.activeElement))).toBe(true);
  visible(await settled(footer));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-marketing-motion]").first()).toHaveAttribute("data-marketing-motion", "reduced");
  const reduced = [];
  for (const target of [pricingHeading, answer, page.locator("#how-it-works h2"), footer]) {
    const value = await settled(target);
    expect(value.effectiveOpacity).toBe(1); expect(value.x).toBe(0); expect(value.y).toBe(0); reduced.push(value);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("[data-marketing-motion]").first()).toHaveAttribute("data-marketing-motion", "full");
  const row = page.locator("[data-flow-row]").first();
  await position(row, "center");
  const restored = await settled(row); visible(restored);
  await position(row, "tail");
  const restoredExit = await settled(row);
  expect(restoredExit.effectiveOpacity).toBeCloseTo(0, 2); expect(restoredExit.y).toBeLessThan(0);
  expect(restoredExit.owners).toBe(1);
  await position(row, "center"); visible(await settled(row));
  await capture(page, info, "lazy-focus-reduced", { late, expanded, reduced, restored, restoredExit });
});

test("all hero examples use public copy and the real stream crosses retained history without gaps", async ({ page }, info) => {
  await timerBudget(page);
  await openLanding(page);
  const hero = page.locator("[data-landing-stage]");
  expect(await hero.count()).toBe(1);
  const scenarios = hero.locator("[data-scenario-pill]");
  expect(await scenarios.count()).toBe(3);
  const copy = [];
  for (let index = 0; index < 3; index++) {
    const button = scenarios.nth(index); await button.click();
    await expect(button).toHaveAttribute("aria-current", "step");
    await page.waitForTimeout(600);
    const value = await hero.innerText();
    expect(value).not.toMatch(/qualified data required|landing (widget|preview)|prototype|implementation|roadmap|coming soon|features? to be implemented/i);
    copy.push({ scenario: await button.innerText(), value });
  }
  const landingCopy = await page.locator("main").innerText();
  expect(landingCopy).not.toMatch(/qualified data required|landing (widget|preview)|prototype|implementation timeline|roadmap|coming soon|features? to be implemented/i);
  await scenarios.first().click();
  const vertical = await touchGesture(page, scenarios.first(), "vertical");
  await expect(scenarios.first()).toHaveAttribute("aria-current", "step");
  expect(vertical.afterY).toBeGreaterThan(vertical.beforeY + 5);
  const horizontal = await touchGesture(page, scenarios.first(), "horizontal");
  await capture(page, info, "native-scenario-gestures", { vertical, horizontal });
  await expect(scenarios.nth(1)).toHaveAttribute("aria-current", "step");
  expect(horizontal.ledger.changes).toHaveLength(1);
  const freshHorizontal = await touchGesture(page, scenarios.nth(1), "horizontal");
  await expect(scenarios.nth(2)).toHaveAttribute("aria-current", "step");
  expect(freshHorizontal.ledger.changes).toHaveLength(1);
  await scenarios.first().click();
  await position(hero.locator("canvas").first(), "center");
  const state = hero.locator("[data-replay-cursor]");
  await expect(state).toHaveAttribute("data-market-following", "true");
  await page.evaluate(() => { (window as any).__landing142Timer.mode = "budget"; });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const indexBefore = Number(await state.getAttribute("data-market-last-index"));
  expect(indexBefore).toBeLessThan(400);
  await deliver(page, 2020 - indexBefore);
  const beforeTrim = await chart(hero); continuous(beforeTrim);
  const priorIndex = Number(await state.getAttribute("data-market-last-index"));
  expect(priorIndex).toBeGreaterThanOrEqual(2020); expect(priorIndex).toBeLessThan(2048);
  await deliver(page, 35);
  const afterTrim = await chart(hero); continuous(afterTrim);
  const firstIndex = Number(await state.getAttribute("data-market-first-index"));
  const lastIndex = Number(await state.getAttribute("data-market-last-index"));
  expect(firstIndex).toBeGreaterThan(0); expect(lastIndex - firstIndex + 1).toBe(2048);
  expect(lastIndex).toBeGreaterThan(priorIndex + 30);
  expect(afterTrim.bars.at(-1)!.time).toBeGreaterThan(beforeTrim.bars.at(-1)!.time);
  const originals = new Map(beforeTrim.bars.map(bar => [bar.time, bar]));
  const overlap = afterTrim.bars.filter(bar => originals.has(bar.time));
  expect(overlap.length).toBeGreaterThan(20);
  for (const bar of overlap) expect(bar).toEqual(originals.get(bar.time));
  expect(afterTrim.bars.filter(bar => bar.close > bar.open).length).toBeGreaterThan(10);
  expect(afterTrim.bars.filter(bar => bar.close < bar.open).length).toBeGreaterThan(10);
  await hero.getByRole("button", { name: "Pause replay", exact: true }).click();
  const pausedIndex = Number(await state.getAttribute("data-market-last-index"));
  await page.waitForTimeout(900); expect(Number(await state.getAttribute("data-market-last-index"))).toBe(pausedIndex);
  await hero.getByRole("button", { name: "Previous candle", exact: true }).click();
  expect(Number(await state.getAttribute("data-replay-cursor"))).toBe(pausedIndex - 1);
  await hero.getByRole("button", { name: "Next candle", exact: true }).click();
  expect(Number(await state.getAttribute("data-replay-cursor"))).toBe(pausedIndex);
  const densities = [];
  for (const width of [320, 960, page.viewportSize()!.width]) {
    await page.setViewportSize({ width, height: page.viewportSize()!.height });
    await position(hero.locator("canvas").first(), "center"); await page.waitForTimeout(500);
    const snapshot = await chart(hero); continuous(snapshot); densities.push({ viewportWidth: width, snapshot });
  }
  await page.evaluate(() => { (window as any).__landing142Timer.mode = "normal"; });
  await hero.getByRole("button", { name: "Play replay", exact: true }).click();
  await expect.poll(async () => Number(await state.getAttribute("data-market-last-index"))).toBeGreaterThan(pausedIndex + 3);
  await capture(page, info, "retention-density-copy", { copy, landingCopy, vertical, horizontal, freshHorizontal,
    timerScheduling: await page.evaluate(() => (window as any).__landing142Timer), indexBefore, priorIndex, firstIndex, lastIndex,
    beforeTrim, afterTrim, overlap: overlap.length, pausedIndex, densities });
});
