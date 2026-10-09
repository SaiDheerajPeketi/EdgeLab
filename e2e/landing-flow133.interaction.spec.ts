import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { gotoStable, installDeterminism } from "./support/app";

const artifacts = path.resolve(".artifacts/landing-flow133");
const errors = new WeakMap<Page, string[]>();
async function openLanding(page: Page) {
  // Keep genuine production GSAP, observers, timers, charts and wall-clock time.
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/billing/catalog", route => route.fulfill({ json: {
    provider: "stripe", enabled: false, mode: "live", checkout_available: false,
    reason: "Billing is not configured.",
    plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
  } }));
  await gotoStable(page, "/");
  await expect.poll(() => page.evaluate(() => typeof (window as any).gsap?.to)).toBe("function");
}
async function receipt(page: Page, info: TestInfo, name: string, data: unknown) {
  fs.mkdirSync(artifacts, { recursive: true });
  const stem = `${name}-${info.project.name}`;
  const json = path.join(artifacts, stem + ".json");
  fs.writeFileSync(json, JSON.stringify(data, null, 2));
  await info.attach(stem, { path: json, contentType: "application/json" });
  await page.screenshot({ path: path.join(artifacts, stem + ".png"), animations: "allow" });
}
async function candleData(hero: Locator) {
  return hero.locator("canvas").first().evaluate(node => {
    // Observe the actual production Candlestick series via its owned React ref.
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
    throw new Error("The actual landing Candlestick series ref is unavailable.");
  }) as Promise<Array<{ time: number; open: number; high: number; low: number; close: number }>>;
}
async function chartViewport(hero: Locator) {
  return hero.locator("canvas").first().evaluate(node => {
    for (let element: Element | null = node; element; element = element.parentElement) {
      const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
      let fiber = key ? (element as any)[key] : null;
      for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const current = hook.memoizedState?.current;
        if (current && typeof current.timeScale === "function" && typeof current.chartElement === "function" && current.chartElement().contains(node)) {
          const scale = current.timeScale();
          return { pageY: scrollY, range: scale.getVisibleLogicalRange(), scrollPosition: scale.scrollPosition() };
        }
      }
    }
    throw new Error("The genuine landing chart viewport ref is unavailable.");
  });
}
async function canvasGestures(page: Page, hero: Locator) {
  const chart = hero.locator("canvas").first(), state = hero.locator("[data-replay-cursor]");
  await center(page, chart);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  const beforePointer = Number(await state.getAttribute("data-market-last-index")), pointerBefore = await chartViewport(hero);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 5 });
  await page.mouse.up();
  const pointerAfter = await chartViewport(hero);
  await page.waitForTimeout(1700);
  const afterPointer = Number(await state.getAttribute("data-market-last-index"));
  expect(await state.getAttribute("data-market-following")).toBe("true");
  expect(afterPointer).toBeGreaterThan(beforePointer + 2);

  await center(page, chart);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const touchBox = await chart.boundingBox();
  expect(touchBox).not.toBeNull();
  const tx = touchBox!.x + touchBox!.width / 2, ty = touchBox!.y + touchBox!.height / 2;
  const beforeTouch = Number(await state.getAttribute("data-market-last-index")), touchBefore = await chartViewport(hero), session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ x: tx, y: ty, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
  });
  for (let step = 1; step <= 6; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: tx, y: ty - step * 10, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
    });
    await page.waitForTimeout(24);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
  const touchAfter = await chartViewport(hero);
  await page.waitForTimeout(1700);
  const afterTouch = Number(await state.getAttribute("data-market-last-index"));
  expect(await state.getAttribute("data-market-following")).toBe("true");
  expect(afterTouch).toBeGreaterThan(beforeTouch + 2);
  return {
    target: "Actual Candlestick canvas, outside scenario controls",
    beforePointer, afterPointer, pointerBefore, pointerAfter, beforeTouch, afterTouch, touchBefore, touchAfter,
    pointerPageScrolled: pointerBefore.pageY !== pointerAfter.pageY,
    touchPageScrolled: touchBefore.pageY !== touchAfter.pageY,
    input: "Native mouse and Chromium touch input; genuine chart refs read only",
  };
}
async function heroTouchScroll(page: Page, hero: Locator) {
  const title = hero.getByText("Explore the trading workspace.", { exact: true });
  await center(page, title);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await title.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + Math.min(box!.width / 2, 100), y = box!.y + box!.height / 2;
  const before = await page.evaluate(() => scrollY);
  const session = await page.context().newCDPSession(page);
  // Native Chromium touch input, not synthetic application handlers or mocked observers.
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  for (let step = 1; step <= 6; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 10, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    await page.waitForTimeout(24);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 5);
  return { before, after: await page.evaluate(() => scrollY), target: "Hero title outside intentional scenario controls", input: "Native Chromium touchStart/touchMove/touchEnd" };
}
async function motion(target: Locator) {
  return target.evaluate(node => {
    let opacity = 1;
    let roots = 0;
    for (let current: HTMLElement | null = node as HTMLElement; current; current = current.parentElement) {
      opacity *= Number(getComputedStyle(current).opacity);
      if (current.style.opacity !== "" && current.style.transform !== "") roots++;
    }
    const style = getComputedStyle(node);
    const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    return { opacity: Number(style.opacity), effectiveOpacity: opacity, x: matrix.m41, y: matrix.m42, roots };
  });
}
async function settled(target: Locator) {
  // Stop moving the viewport and allow the authored finite tween to finish.
  await target.page().waitForTimeout(1500);
  const first = await motion(target);
  await target.page().waitForTimeout(250);
  const second = await motion(target);
  for (const key of ["opacity", "effectiveOpacity", "x", "y"] as const) expect(Math.abs(first[key] - second[key])).toBeLessThan(.01);
  return second;
}
async function componentOwner(row: Locator) {
  return (await row.evaluate(node => (node as HTMLElement).style.opacity !== "")) ? row : row.locator("[data-flow-content]");
}
async function center(page: Page, target: Locator) {
  await target.evaluate(node => {
    const rect = node.getBoundingClientRect();
    window.scrollTo({ top: scrollY + rect.top + rect.height / 2 - innerHeight / 2, behavior: "instant" });
  });
}
test.beforeEach(({ page }) => {
  const recorded: string[] = [];
  errors.set(page, recorded);
  page.on("pageerror", error => recorded.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test("live hero continues across chart wheel scrolling and offscreen pause/resume without a completed-session reset", async ({ page }, info) => {
  await openLanding(page);
  const hero = page.locator("[data-landing-stage]");
  await center(page, hero);
  const state = hero.locator("[data-replay-cursor]");
  await expect(state).toHaveAttribute("data-market-following", "true");
  const initial = await candleData(hero);
  const firstIndex = Number(await state.getAttribute("data-market-last-index"));
  await expect.poll(async () => Number(await state.getAttribute("data-market-last-index"))).toBeGreaterThan(firstIndex + 6);
  const chart = hero.locator("canvas").first();
  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, Math.min(box!.y + box!.height / 2, page.viewportSize()!.height - 40));
  const beforeWheel = Number(await state.getAttribute("data-market-last-index"));
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(1700);
  const afterWheel = Number(await state.getAttribute("data-market-last-index"));
  const following = await state.getAttribute("data-market-following");
  await receipt(page, info, "hero-wheel", { firstIndex, beforeWheel, afterWheel, following, initial, afterWheelCandles: await candleData(hero) });
  expect(following).toBe("true");
  expect(afterWheel).toBeGreaterThan(beforeWheel + 2);
  await center(page, hero);
  const title = hero.getByText("Explore the trading workspace.", { exact: true });
  await center(page, title);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const titleBox = await title.boundingBox();
  expect(titleBox).not.toBeNull();
  const beforePointer = Number(await state.getAttribute("data-market-last-index"));
  await page.mouse.move(titleBox!.x + 40, titleBox!.y + titleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(titleBox!.x + 40, titleBox!.y + titleBox!.height / 2 - 45, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(1700);
  const afterPointer = Number(await state.getAttribute("data-market-last-index"));
  expect(await state.getAttribute("data-market-following")).toBe("true");
  expect(afterPointer).toBeGreaterThan(beforePointer + 2);
  const beforeTouch = Number(await state.getAttribute("data-market-last-index"));
  const touch = await heroTouchScroll(page, hero);
  await page.waitForTimeout(1700);
  const afterTouch = Number(await state.getAttribute("data-market-last-index"));
  expect(await state.getAttribute("data-market-following")).toBe("true");
  expect(afterTouch).toBeGreaterThan(beforeTouch + 2);
  await receipt(page, info, "hero-gestures", { beforePointer, afterPointer, beforeTouch, afterTouch, touch, following: await state.getAttribute("data-market-following") });
  const canvas = await canvasGestures(page, hero);
  await receipt(page, info, "hero-canvas-gestures", canvas);
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  const paused = Number(await state.getAttribute("data-market-last-index"));
  await page.waitForTimeout(700);
  expect(Number(await state.getAttribute("data-market-last-index"))).toBe(paused);
  await center(page, hero);
  await expect.poll(async () => Number(await state.getAttribute("data-market-last-index"))).toBeGreaterThan(paused + 6);
  const final = await candleData(hero);
  expect(final.at(-1)!.time).toBeGreaterThan(initial.at(-1)!.time);
  expect(final.length).toBeGreaterThanOrEqual(64);
  expect(final.filter(bar => bar.close > bar.open).length).toBeGreaterThan(10);
  expect(final.filter(bar => bar.close < bar.open).length).toBeGreaterThan(10);
  const prior = new Map(initial.map(bar => [bar.time, bar]));
  for (const bar of final) if (prior.has(bar.time)) expect(bar).toEqual(prior.get(bar.time));
  for (let i = 1; i < final.length; i++) expect(final[i].time - final[i - 1].time).toBe(300);
  await receipt(page, info, "hero-resumed", { paused, final, finalIndex: await state.getAttribute("data-market-last-index") });
  for (const [name, target] of [["capability-sample", page.locator("#capabilities article").first()], ["trust-sample", page.locator("#evidence article").first()]] as const) {
    await center(page, target);
    const visible = await settled(target);
    expect(visible.effectiveOpacity).toBeCloseTo(1, 2);
    await receipt(page, info, name, { title: await target.locator("h3").innerText(), motion: visible });
  }
});

test("workflow, capability and evidence articles and standalone headings finish finite motion with one owner", async ({ page }, info) => {
  test.setTimeout(150_000);
  await openLanding(page);
  const workflows = page.locator("[data-flow-row]");
  const capabilities = page.locator("#capabilities article[data-marketing-flow]");
  const trust = page.locator("#evidence article[data-marketing-flow]");
  expect(await workflows.count()).toBe(4);
  expect(await capabilities.count()).toBe(6);
  expect(await trust.count()).toBe(4);
  const evidence = [];
  for (const [kind, rows] of [["workflow", workflows], ["capability", capabilities], ["trust", trust]] as const) {
    for (let i = 0; i < await rows.count(); i++) {
      const row = rows.nth(i);
      const owner = kind === "workflow" ? await componentOwner(row) : row;
      const textTargets = [row.locator("h3"), row.locator(kind === "workflow" ? "[data-flow-content] > p" : ":scope > p")];
      await center(page, row);
      const entered = await settled(owner);
      const enteredText = await Promise.all(textTargets.map(motion));
      await page.locator("#faq").scrollIntoViewIfNeeded();
      const exited = await settled(owner);
      const exitedText = await Promise.all(textTargets.map(motion));
      await center(page, row);
      const returned = await settled(owner);
      const returnedText = await Promise.all(textTargets.map(motion));
      evidence.push({ kind, title: await row.locator("h3").innerText(), entered, enteredText, exited, exitedText, returned, returnedText });
    }
  }
  const headings = [];
  for (const target of [page.locator("#capability-status-title"), page.locator("#pricing h2").first(), page.locator("#faq h2").first()]) {
    await center(page, target);
    const entered = await settled(target);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const exited = await settled(target);
    await center(page, target);
    const returned = await settled(target);
    headings.push({ title: await target.innerText(), entered, exited, returned });
  }
  await receipt(page, info, "workflow-flow", { articles: evidence, headings });
  for (const row of evidence) {
    expect(row.entered.effectiveOpacity, row.title).toBeCloseTo(1, 2);
    expect(row.entered.y, row.title).toBeCloseTo(0, 2);
    expect(row.exited.effectiveOpacity, row.title + " component exit").toBeCloseTo(0, 2);
    expect(row.returned.effectiveOpacity, row.title).toBeCloseTo(1, 2);
    expect(row.returned.y, row.title).toBeCloseTo(0, 2);
    for (const text of [...row.enteredText, ...row.returnedText]) {
      expect(text.effectiveOpacity, row.title + " own text entrance/reentry").toBeCloseTo(1, 2);
      expect(text.roots, row.title + " duplicate nested motion").toBe(1);
    }
    for (const text of row.exitedText) {
      expect(text.effectiveOpacity, row.title + " text exit").toBeCloseTo(0, 2);
      expect(text.roots, row.title + " duplicate nested motion").toBe(1);
    }
  }
  for (const heading of headings) {
    expect(heading.entered.effectiveOpacity, heading.title).toBeCloseTo(1, 2);
    expect(heading.entered.y, heading.title).toBeCloseTo(0, 2);
    expect(heading.exited.effectiveOpacity, heading.title).toBeCloseTo(0, 2);
    expect(heading.returned.effectiveOpacity, heading.title).toBeCloseTo(1, 2);
    for (const state of [heading.entered, heading.exited, heading.returned]) expect(state.roots, heading.title + " single owner").toBe(1);
  }
});

test("footer and final CTA retain keyboard focus visibility and recover live motion preferences", async ({ page }, info) => {
  await openLanding(page);
  const footer = page.locator('[data-marketing-reveal="footer"]');
  const cta = page.locator(".landing-story > section").last().locator("a[data-marketing-flow]");
  const evidence = [];
  for (const target of [footer, cta]) {
    await target.scrollIntoViewIfNeeded();
    await settled(target);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const hidden = await settled(target);
    expect(hidden.effectiveOpacity).toBeCloseTo(0, 2);
    const control = target === footer ? target.getByRole("link", { name: "Privacy", exact: true }) : target;
    await control.evaluate(node => (node as HTMLElement).focus({ preventScroll: true }));
    expect(await control.evaluate(node => document.activeElement === node)).toBe(true);
    const focused = await settled(target);
    expect(focused.effectiveOpacity).toBeCloseTo(1, 2);
    expect(focused.y).toBeCloseTo(0, 2);
    await control.evaluate(node => (node as HTMLElement).blur());
    evidence.push({ hidden, focused });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => (await motion(footer)).effectiveOpacity).toBe(1);
  for (const target of [footer, cta]) {
    const reduced = await settled(target);
    expect(reduced.effectiveOpacity).toBe(1);
    expect(reduced.x).toBe(0);
    expect(reduced.y).toBe(0);
  }
  const hero = page.locator("[data-landing-stage]");
  await center(page, hero);
  const state = hero.locator("[data-replay-cursor]");
  await expect(hero.getByRole("button", { name: /^(Play|Pause) replay$/ })).toBeDisabled();
  const held = await state.getAttribute("data-market-last-index");
  await page.waitForTimeout(800);
  expect(await state.getAttribute("data-market-last-index")).toBe(held);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(async () => Number(await state.getAttribute("data-market-last-index"))).toBeGreaterThan(Number(held) + 3);
  await receipt(page, info, "focus-motion", { evidence, held, resumed: await state.getAttribute("data-market-last-index") });
});

test("public landing advertises current capabilities without internal qualification or roadmap badges", async ({ page }, info) => {
  await openLanding(page);
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1300);
  const copy = await page.locator("main").innerText();
  await receipt(page, info, "public-copy", { copy });
  expect(copy).not.toMatch(/qualified data required|provider dependent|compatibility beta|future capability|features? to be implemented|implementation timeline|roadmap|coming soon/i);
  await expect(page.getByRole("heading", { name: /replay|continuous loop/i }).first()).toBeAttached();
});
