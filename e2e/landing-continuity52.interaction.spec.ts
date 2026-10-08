import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { certifyUiState, gotoStable, installDeterminism } from "./support/app";

const artifacts = path.resolve(".artifacts/landing-continuity52");
const errors = new WeakMap<Page, string[]>();

async function openLanding(page: Page, reducedMotion = false) {
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  await page.route("**/api/billing/catalog", (route) => route.fulfill({ json: {
    provider: "stripe",
    enabled: false,
    mode: "live",
    checkout_available: false,
    reason: "Billing is not configured.",
    plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
  } }));
  await gotoStable(page, "/");
}

async function capture(page: Page, name: string, evidence: unknown, target?: Locator) {
  fs.mkdirSync(artifacts, { recursive: true });
  // Keep real page chrome, native animation state and intersection observers.
  if (target) await target.screenshot({ path: path.join(artifacts, name + ".png"), animations: "allow" });
  else await page.screenshot({ path: path.join(artifacts, name + ".png"), animations: "allow" });
  fs.writeFileSync(path.join(artifacts, name + ".json"), JSON.stringify(evidence, null, 2));
}

async function candleData(hero: Locator) {
  return hero.locator("canvas").first().evaluate((node) => {
    // Read the actual chart's public data API through its component ref; do not
    // install a replacement chart, generator, observer or timer.
    for (let element: Element | null = node; element; element = element.parentElement) {
      const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$"));
      let fiber = fiberKey ? (element as any)[fiberKey] : null;
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

function continuousBars(bars: Awaited<ReturnType<typeof candleData>>) {
  expect(bars.length).toBeGreaterThanOrEqual(64);
  let up = 0;
  let down = 0;
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    for (const value of Object.values(bar)) expect(Number.isFinite(value)).toBe(true);
    expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
    expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
    if (index) expect(bar.time - bars[index - 1].time).toBe(300);
    if (bar.close > bar.open) up++;
    if (bar.close < bar.open) down++;
  }
  expect(up).toBeGreaterThan(10);
  expect(down).toBeGreaterThan(10);
}

async function candlePixels(hero: Locator) {
  return hero.locator("canvas").first().evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const context = canvas.getContext("2d")!;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const limit = Math.floor(canvas.width - 70 * canvas.width / box.width);
    let green = 0;
    let red = 0;
    const columns = new Set<number>();
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < limit; x++) {
      const i = (y * canvas.width + x) * 4;
      const up = data[i] === 38 && data[i + 1] === 166 && data[i + 2] === 154;
      const down = data[i] === 239 && data[i + 1] === 83 && data[i + 2] === 80;
      if (up) green++;
      if (down) red++;
      if (up || down) columns.add(x);
    }
    const sorted = [...columns].sort((a, b) => a - b);
    return { green, red, columns: sorted.length, span: sorted.length ? sorted.at(-1)! - sorted[0] + 1 : 0,
      maxGap: Math.max(0, ...sorted.slice(1).map((value, index) => value - sorted[index] - 1)), width: canvas.width, height: canvas.height };
  });
}

async function pose(target: Locator) {
  return target.evaluate((node) => {
    const style = getComputedStyle(node);
    const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    return { opacity: Number(style.opacity), x: matrix.m41, y: matrix.m42, scaleX: matrix.m11, scaleY: matrix.m22 };
  });
}

async function completedPose(target: Locator) {
  let previous = await pose(target);
  await expect.poll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const current = await pose(target);
    const difference = Math.max(...Object.keys(current).map((key) => Math.abs(current[key as keyof typeof current] - previous[key as keyof typeof previous])));
    previous = current;
    return difference;
  }).toBeLessThan(0.001);
  await target.page().waitForTimeout(650);
  const settled = await pose(target);
  for (const key of Object.keys(settled)) expect(Math.abs(settled[key as keyof typeof settled] - previous[key as keyof typeof previous])).toBeLessThan(0.01);
  return settled;
}

test.beforeEach(({ page }) => {
  const recorded: string[] = [];
  errors.set(page, recorded);
  page.on("pageerror", (error) => recorded.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test("one dense continuous candle demo keeps history through playback pause steps and resize", async ({ page }, info) => {
  await openLanding(page);
  const hero = page.locator("[data-landing-stage]");
  await hero.scrollIntoViewIfNeeded();
  await expect(page.locator("[data-replay-cursor]")).toHaveCount(1);
  const state = hero.locator("[data-replay-cursor]");
  await expect(hero.locator("canvas").first()).toBeVisible();
  await expect.poll(async () => (await candleData(hero)).length).toBeGreaterThanOrEqual(64);
  const initial = await candleData(hero);
  continuousBars(initial);
  const initialTail = Number(await state.getAttribute("data-market-last-index"));
  await expect.poll(async () => Number(await state.getAttribute("data-market-last-index"))).toBeGreaterThan(initialTail + 6);
  await hero.getByRole("button", { name: "Pause replay", exact: true }).click();
  const progressed = await candleData(hero);
  continuousBars(progressed);
  const prior = new Map(initial.map((bar) => [bar.time, bar]));
  const shared = progressed.filter((bar) => prior.has(bar.time));
  expect(shared.length).toBeGreaterThan(40);
  for (const bar of shared) expect(bar).toEqual(prior.get(bar.time));
  expect(progressed.at(-1)!.time).toBeGreaterThan(initial.at(-1)!.time);
  const paused = Number(await state.getAttribute("data-replay-cursor"));
  await page.waitForTimeout(650);
  await expect(state).toHaveAttribute("data-replay-cursor", String(paused));
  await hero.getByRole("button", { name: "Previous candle", exact: true }).click();
  await expect(state).toHaveAttribute("data-replay-cursor", String(paused - 1));
  await hero.getByRole("button", { name: "Next candle", exact: true }).click();
  await expect(state).toHaveAttribute("data-replay-cursor", String(paused));
  await hero.getByRole("button", { name: "Next candle", exact: true }).click();
  await expect(state).toHaveAttribute("data-replay-cursor", String(paused + 1));
  const slider = hero.getByRole("slider", { name: "Replay position", exact: true });
  await slider.fill(String(paused - 5));
  await page.locator("#faq").scrollIntoViewIfNeeded();
  await page.waitForTimeout(650);
  await expect(state).toHaveAttribute("data-replay-cursor", String(paused - 5));
  await hero.scrollIntoViewIfNeeded();
  await expect(state).toHaveAttribute("data-replay-cursor", String(paused - 5));
  await hero.getByRole("button", { name: "Play replay", exact: true }).click();
  await expect.poll(async () => Number(await state.getAttribute("data-replay-cursor"))).toBeGreaterThanOrEqual(paused + 1);
  await hero.getByRole("button", { name: "Pause replay", exact: true }).click();
  const finalCursor = Number(await state.getAttribute("data-replay-cursor"));
  const pixels = await candlePixels(hero);
  expect(pixels.green).toBeGreaterThan(50);
  expect(pixels.red).toBeGreaterThan(50);
  expect(pixels.columns / pixels.span).toBeGreaterThan(0.35);
  expect(pixels.maxGap).toBeLessThanOrEqual(Math.ceil(pixels.span / (await candleData(hero)).length * 3));
  const resized = { width: info.project.use.viewport!.width > 1280 ? 1024 : info.project.use.viewport!.width - 16, height: info.project.use.viewport!.height };
  await page.setViewportSize(resized);
  await expect.poll(async () => (await candlePixels(hero)).width).not.toBe(pixels.width);
  continuousBars(await candleData(hero));
  await expect(state).toHaveAttribute("data-replay-cursor", String(finalCursor));
  await page.setViewportSize(info.project.use.viewport!);
  await hero.scrollIntoViewIfNeeded();
  await capture(page, "continuous-" + info.project.name, { initial, progressed, pixels, paused, finalCursor, final: await candleData(hero) }, hero);
});

test("finite text and scene transitions finish after scroll stops and reverse on reentry", async ({ page }, info) => {
  await openLanding(page);
  const heading = page.locator("[data-marketing-reveal=title]");
  await heading.scrollIntoViewIfNeeded();
  const title = await completedPose(heading);
  expect(title.opacity).toBeCloseTo(1, 2);
  const scene = page.locator("[data-flow-row]").first();
  const content = scene.locator("h3").first();
  const description = scene.locator("[data-flow-content] > p");
  await scene.scrollIntoViewIfNeeded();
  const entered = await completedPose(content);
  expect(entered.opacity).toBeCloseTo(1, 2);
  expect(entered.y).toBeCloseTo(0, 2);
  const enteredDescription = await completedPose(description);
  expect(enteredDescription.opacity).toBeCloseTo(1, 2);
  await page.locator("#faq").scrollIntoViewIfNeeded();
  const exited = await completedPose(content);
  expect(exited.opacity).toBeCloseTo(0, 2);
  expect(exited.y).toBeCloseTo(28, 2);
  await scene.scrollIntoViewIfNeeded();
  const reentered = await completedPose(content);
  expect(reentered.opacity).toBeCloseTo(1, 2);
  expect(reentered.y).toBeCloseTo(0, 2);
  await capture(page, "finite-motion-" + info.project.name, { title, entered, enteredDescription, exited, reentered }, scene);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await scene.scrollIntoViewIfNeeded();
  const reduced = await completedPose(content);
  expect(reduced.opacity).toBeCloseTo(1, 2);
  expect(reduced.x).toBeCloseTo(0, 2);
  expect(reduced.y).toBeCloseTo(0, 2);
  const hero = page.locator("[data-landing-stage]");
  await hero.scrollIntoViewIfNeeded();
  await expect(hero.getByRole("button", { name: /^(Play|Pause) replay$/ })).toBeDisabled();
  const state = hero.locator("[data-replay-cursor]");
  const cursor = Number(await state.getAttribute("data-replay-cursor"));
  await page.waitForTimeout(650);
  await expect(state).toHaveAttribute("data-replay-cursor", String(cursor));
  await hero.getByRole("button", { name: "Next candle", exact: true }).click();
  await expect(state).toHaveAttribute("data-replay-cursor", String(cursor + 1));
  continuousBars(await candleData(hero));
  await capture(page, "reduced-motion-" + info.project.name, { reduced, cursor, candles: await candleData(hero) }, hero);
});

test("large actual WebGL model rotates with readable current public copy", async ({ page }, info) => {
  await openLanding(page, true);
  const scene = page.locator("[data-market-sculpture]");
  await scene.scrollIntoViewIfNeeded();
  await expect(scene).toHaveAttribute("data-scene-status", "ready");
  const canvas = scene.locator("canvas");
  const gpu = await canvas.evaluate((node) => {
    const gl = (node as HTMLCanvasElement).getContext("webgl2") ?? (node as HTMLCanvasElement).getContext("webgl");
    if (!gl) throw new Error("Actual production WebGL context missing.");
    return { lost: gl.isContextLost(), width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, version: gl.getParameter(gl.VERSION) };
  });
  expect(gpu.lost).toBe(false);
  expect(gpu.width).toBeGreaterThan(250);
  expect(gpu.height).toBeGreaterThan(200);
  const before = await canvas.screenshot({ animations: "allow" });
  await scene.getByRole("button", { name: "Rotate scene left", exact: true }).click();
  await expect(scene).toHaveAttribute("data-camera", "-0.08,0.00");
  await expect.poll(async () => (await canvas.screenshot({ animations: "allow" })).equals(before)).toBe(false);
  const image = (await canvas.screenshot({ animations: "allow" })).toString("base64");
  const coverage = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = "data:image/png;base64," + base64;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = pixels.slice(i, i + 3);
      if ((g > 75 && g > r * 1.2 && g > b * 1.02) || (r > 100 && r > g * 1.25 && b > g * 1.02)) {
        const x = (i / 4) % canvas.width;
        const y = Math.floor(i / 4 / canvas.width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        colored++;
      }
    }
    return { colored, width: canvas.width, height: canvas.height,
      modelWidth: maxX - minX, modelHeight: maxY - minY };
  }, image);
  expect(coverage.colored).toBeGreaterThan(500);
  expect(coverage.modelWidth / coverage.width).toBeGreaterThan(0.55);
  expect(coverage.modelHeight / coverage.height).toBeGreaterThan(0.25);
  await expect(page.getByRole("heading", { name: /roadmap|coming soon/i })).toHaveCount(0);
  const copy = await page.locator("main").innerText();
  expect(copy).not.toMatch(/future capability|unbuilt|roadmap|coming soon|future catalog|waitlist|beta seats/i);
  await certifyUiState(page);
  await capture(page, "sculpture-" + info.project.name, { gpu, coverage, copy }, scene);
  if (info.project.name === "desktop1440") {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await capture(page, "hero-viewport-desktop1440", { gpu, coverage, viewport: page.viewportSize() });
  }
});


test("focused controls stay visible across completed scroll exits and reduced-motion changes", async ({ page }, info) => {
  await openLanding(page);
  const heroActions = page.locator('[data-marketing-reveal="hero-actions"]');
  const sculpture = page.locator('[data-marketing-flow]').filter({ has: page.locator('[data-market-sculpture]') });
  const privacy = page.getByRole('link', { name: 'privacy summary', exact: true });
  const privacyParagraph = privacy.locator('..');
  const footer = page.locator('[data-marketing-reveal="footer"]');
  const cases = [
    { ancestor: heroActions, control: heroActions.getByRole('link').first(), below: true },
    { ancestor: sculpture, control: sculpture.getByRole('button', { name: 'Rotate scene left', exact: true }), below: true },
    { ancestor: privacyParagraph, control: privacy, below: true },
    { ancestor: footer, control: footer.getByRole('link', { name: 'Privacy', exact: true }), below: false },
  ];
  const evidence = [];
  for (const { ancestor, control, below } of cases) {
    // Exercise the real completed exit, then focus without moving the viewport.
    // Focus must win even if scroll stays stopped outside the trigger range.
    await page.evaluate((toBottom) => window.scrollTo(0, toBottom ? document.documentElement.scrollHeight : 0), below);
    await expect.poll(async () => (await pose(ancestor)).opacity).toBe(0);
    const hidden = await pose(ancestor);
    await control.evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
    expect(await control.evaluate((node) => document.activeElement === node)).toBe(true);
    const focused = await pose(ancestor);
    expect(focused.opacity).toBe(1);
    expect(focused.x).toBe(0);
    expect(focused.y).toBe(0);
    await page.waitForTimeout(850);
    expect((await pose(ancestor)).opacity).toBe(1);
    await control.evaluate((node) => (node as HTMLElement).blur());
    await expect.poll(async () => (await pose(ancestor)).opacity).toBe(0);
    evidence.push({ hidden, focused, blurred: await pose(ancestor) });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const { ancestor } of cases) {
    await expect.poll(async () => (await pose(ancestor)).opacity).toBe(1);
    expect((await pose(ancestor)).y).toBe(0);
  }
  await sculpture.scrollIntoViewIfNeeded();
  await sculpture.getByRole('button', { name: 'Decisions', exact: true }).click();
  await capture(page, 'focus-guard71-' + info.project.name, { evidence, reduced: await pose(sculpture) }, sculpture);
});
