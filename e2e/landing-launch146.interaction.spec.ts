import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { AUTH_SESSION_KEY, GOOGLE_STATE_KEY, gotoStable, installDeterminism } from "./support/app";

const artifacts = path.resolve(".artifacts/landing-launch146");
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
function distSeal() {
  const entries: string[] = [];
  for (const file of fs.readdirSync("frontend/dist", { recursive: true })) {
    const relative = String(file), target = path.join("frontend/dist", relative);
    if (fs.statSync(target).isFile()) entries.push(relative + ":" + hash(fs.readFileSync(target)));
  }
  return { files: entries.length, sha256: hash(entries.sort().join("\n")) };
}
const beforeSeal = distSeal();
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); expect(distSeal()).toEqual(beforeSeal); });
async function openLanding(page: Page, url = "/") {
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  // installDeterminism sets reduce; restore the actual full-motion test contract.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/billing/catalog", route => route.fulfill({ json: { provider: "stripe", enabled: false,
    mode: "live", checkout_available: false, reason: "Billing is not configured.",
    plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }] } }));
  await gotoStable(page, url);
  await expect.poll(() => page.evaluate(() => typeof (window as any).gsap?.to)).toBe("function");
}
async function pose(target: Locator) {
  return target.evaluate(node => {
    let opacity = 1, owners = 0;
    for (let current: HTMLElement | null = node as HTMLElement; current; current = current.parentElement) {
      opacity *= Number(getComputedStyle(current).opacity);
      if (current.style.opacity !== "" && current.style.transform !== "") owners++;
    }
    const style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform), rect = node.getBoundingClientRect();
    return { opacity, y: matrix.m42, owners, top: rect.top, bottom: rect.bottom, height: rect.height, scrollY, viewport: innerHeight };
  });
}
async function position(target: Locator, location: "below" | "entry" | "tail" | "gone" | "center") {
  await target.evaluate((node, where) => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    const desiredTop = where === "below" ? innerHeight * 1.08 : where === "entry" ? innerHeight * .84 :
      where === "tail" ? 24 - rect.height : where === "gone" ? -96 - rect.height : innerHeight / 2 - rect.height / 2;
    scrollTo({ top: scrollY + rect.top - matrix.m42 - desiredTop, behavior: "instant" });
  }, location);
  await target.page().waitForTimeout(1500);
}
async function finished(target: Locator, visible: boolean) {
  await expect.poll(async () => { const state = await pose(target); return Math.abs(state.opacity - (visible ? 1 : 0)) < .005 && (!visible || Math.abs(state.y) < .01); }).toBe(true);
  const before = await pose(target); await target.page().waitForTimeout(180); const after = await pose(target);
  expect(Math.abs(after.opacity - before.opacity)).toBeLessThan(.005); expect(Math.abs(after.y - before.y)).toBeLessThan(.01);
  expect(after.scrollY).toBe(before.scrollY); expect(after.owners).toBe(1); return after;
}
async function capture(page: Page, info: TestInfo, name: string, evidence: unknown, target?: Locator) {
  const folder = path.join(artifacts, info.project.name); fs.mkdirSync(folder, { recursive: true });
  const afterSeal = distSeal(); expect(afterSeal).toEqual(beforeSeal);
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify({ beforeSeal, afterSeal, evidence, applicationErrors: errors.get(page),
    qualification: "Actual production DOM, GSAP and Lightweight Charts. Only presentation HTTP seams; market callbacks use their unchanged normal 280ms scheduling. Illustrative market, no external live-feed or financial-performance claim." }, null, 2));
  if (target) await target.screenshot({ path: path.join(folder, name + ".png"), animations: "allow" });
  else await page.screenshot({ path: path.join(folder, name + ".png"), animations: "allow" });
}
async function chart(target: Locator) {
  return target.locator("canvas").first().evaluate(node => {
    let series: any, chart: any;
    for (let element: Element | null = node; element; element = element.parentElement) {
      const key = Object.keys(element).find(value => value.startsWith("__reactFiber$"));
      for (let fiber = key ? (element as any)[key] : null, depth = 0; fiber && depth < 30; fiber = fiber.return, depth++) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const current = hook.memoizedState?.current;
          if (current?.seriesType?.() === "Candlestick") series ??= current;
          if (typeof current?.timeScale === "function" && current.chartElement?.().contains(node)) chart ??= current;
        }
      }
    }
    if (!series || !chart) throw Error("Actual landing chart refs unavailable");
    const root = node.closest("[data-replay-cursor]")!;
    const bars = series.data().map((bar: any) => ({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close }));
    const scale = chart.timeScale();
    return { bars, cursor: Number(root.getAttribute("data-replay-cursor")), lastIndex: Number(root.getAttribute("data-market-last-index")),
      width: scale.width(), spacing: scale.options().barSpacing, firstX: scale.timeToCoordinate(bars[0]?.time), lastX: scale.timeToCoordinate(bars.at(-1)?.time) };
  }) as Promise<{ bars: Array<{ time: number; open: number; high: number; low: number; close: number }>; cursor: number; lastIndex: number; width: number; spacing: number; firstX: number; lastX: number }>;
}
function continuous(state: Awaited<ReturnType<typeof chart>>) {
  expect(state.cursor).toBe(state.lastIndex); expect(state.bars.length).toBeGreaterThanOrEqual(64); expect(state.bars.length).toBeLessThanOrEqual(256);
  expect(state.firstX).toBeLessThanOrEqual(Math.max(6, state.spacing)); expect(state.width - state.lastX).toBeLessThanOrEqual(Math.max(6, state.spacing));
  expect(state.bars.some(bar => bar.close > bar.open)).toBe(true); expect(state.bars.some(bar => bar.close < bar.open)).toBe(true);
  for (let i = 0; i < state.bars.length; i++) {
    const bar = state.bars[i]; expect(Object.values(bar).every(Number.isFinite)).toBe(true);
    expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close)); expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
    if (i) { expect(bar.time - state.bars[i - 1].time).toBe(300); expect(bar.open).toBe(state.bars[i - 1].close); }
  }
}
const forbidden = /\b96 candles\b|\bone example session\b|\bbars shown\b|\bcandles shown\b|\bfirst candle\b|\blast candle\b|\bgenerated\b|qualified data required|coming soon|implementation timeline|feature roadmap/i;

test("hero contains clean product scenarios and a continuous market without replay or tape transport", async ({ page }, info) => {
  await openLanding(page); const hero = page.locator("[data-replay-cursor]");
  await expect(hero).toHaveCount(1);
  await capture(page, info, "launch-hero-top", { presentation: await page.locator("[data-marketing-variant]").getAttribute("data-marketing-variant") });
  for (const label of ["Replay", "Journal", "Results"]) {
    await hero.getByRole("button", { name: label === "Journal" ? /^Journal(?: \+ review)?$/ : label, exact: true }).click();
    expect(await page.locator("main").innerText()).not.toMatch(forbidden);
    await expect(page.locator('main input[type="range"]')).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Replay controls", exact: true })).toHaveCount(0);
    await expect(page.locator("main").getByRole("button", { name: /pause (?:replay|market tape)|play replay|next candle|previous candle/i })).toHaveCount(0);
  }
  await hero.getByRole("button", { name: "Replay", exact: true }).click(); await hero.scrollIntoViewIfNeeded();
  await expect(hero.locator("canvas").first()).toBeVisible();
  const before = await chart(hero); continuous(before);
  await expect.poll(async () => (await chart(hero)).cursor).toBeGreaterThan(before.lastIndex + 4);
  const after = await chart(hero); continuous(after); expect(after.bars.at(-1)!.time).toBeGreaterThan(before.bars.at(-1)!.time);
  const overlap = before.bars.filter(bar => after.bars.some(next => next.time === bar.time)); expect(overlap.length).toBeGreaterThan(30);
  for (const bar of overlap) expect(after.bars.find(next => next.time === bar.time)).toEqual(bar);
  await capture(page, info, "clean-continuous-hero", { before, after, immutableOverlap: overlap.length, forbiddenPublicCaptions: false }, hero);
  const reduce = page.getByRole("checkbox", { name: "Reduce motion", exact: true });
  await reduce.check(); await hero.scrollIntoViewIfNeeded(); await page.waitForTimeout(350);
  const paused = await chart(hero); await page.waitForTimeout(850); expect((await chart(hero)).cursor).toBe(paused.cursor);
  await reduce.uncheck(); await hero.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await chart(hero)).cursor).toBeGreaterThan(paused.cursor + 1);
  const resumed = await chart(hero); continuous(resumed);
  await page.locator("#faq").scrollIntoViewIfNeeded(); await page.waitForTimeout(350);
  const offscreen = Number(await hero.getAttribute("data-replay-cursor")); await page.waitForTimeout(850);
  expect(Number(await hero.getAttribute("data-replay-cursor"))).toBe(offscreen);
  await hero.scrollIntoViewIfNeeded(); await expect.poll(async () => Number(await hero.getAttribute("data-replay-cursor"))).toBeGreaterThan(offscreen + 1);
  await capture(page, info, "motion-preference-and-return", { paused: paused.cursor, resumed: resumed.cursor, offscreen, returned: (await chart(hero)).cursor }, hero);
});

test("stopped entry finishes, visible section tails stay readable and only offscreen sections leave", async ({ page }, info) => {
  await openLanding(page); const evidence = [];
  await expect(page.locator(".chart-ohlcv-row strong").first()).toBeVisible();
  const typography = await page.locator(".marketing-shell").evaluate(shell => {
    const font = (node: Element) => getComputedStyle(node).fontFamily;
    return { body: font(shell), headings: [...shell.querySelectorAll("h1,h2,h3")].map(font), data: [...shell.querySelectorAll(".font-data,.font-mono,.chart-ohlcv-row,.chart-ohlcv-row strong")].map(font),
      sectionHeadings: [...shell.querySelectorAll(".landing-section-title")].map(node => ({ family: font(node), weight: getComputedStyle(node).fontWeight, lineHeight: getComputedStyle(node).lineHeight, fontSize: getComputedStyle(node).fontSize })) };
  });
  for (const family of [typography.body, ...typography.headings, ...typography.data]) expect(family).toMatch(/^"?Instrument Sans/);
  expect(typography.data.length).toBeGreaterThan(0); expect(typography.sectionHeadings.length).toBeGreaterThanOrEqual(3);
  for (const heading of typography.sectionHeadings) { expect(heading.family).toBe(typography.body); expect(heading.weight).toBe("500"); expect(Number.parseFloat(heading.lineHeight) / Number.parseFloat(heading.fontSize)).toBeCloseTo(1.06, 2); }
  const targets = [page.locator("#how-it-works h2"), page.locator('#how-it-works [data-marketing-reveal$="-body"]'),
    page.locator("[data-flow-row]").first(), page.locator("#capabilities article").first()];
  for (const target of targets) {
    await position(target, "below"); await finished(target, false);
    await position(target, "entry"); const entered = await finished(target, true);
    await position(target, "tail"); const tail = await finished(target, true); expect(tail.bottom).toBeGreaterThan(0);
    await position(target, "gone"); const exited = await finished(target, false); expect(exited.bottom).toBeLessThan(-48);
    await position(target, "center"); const reverse = await finished(target, true);
    evidence.push({ tag: await target.evaluate(node => node.tagName), entered, tail, exited, reverse });
  }
  await position(page.locator("[data-flow-row]").first(), "center"); await finished(page.locator("[data-flow-row]").first(), true);
  await capture(page, info, "finished-scroll-motion", { evidence, typography });
});

test("launch is default and beta presentation cannot mutate auth or operational CTA", async ({ page }, info) => {
  await openLanding(page); const hero = page.locator("[data-landing-hero]");
  await expect(page.locator("[data-marketing-variant]")).toHaveAttribute("data-marketing-variant", "production");
  await expect(hero).toContainText("Monthly or yearly Pro subscriptions");
  await expect(hero).not.toContainText("Private beta");
  const cta = hero.locator('[data-marketing-reveal="hero-actions"] a').first(); const operationalHref = await cta.getAttribute("href");
  const authState = () => page.evaluate(({ auth, google }) => ({ localAuth: localStorage.getItem(auth), sessionAuth: sessionStorage.getItem(auth),
    googleState: sessionStorage.getItem(google), localGoogle: localStorage.getItem(google) }), { auth: AUTH_SESSION_KEY, google: GOOGLE_STATE_KEY });
  const before = await authState();
  await gotoStable(page, "/?variant=beta"); await expect(hero).toContainText("Private beta");
  await expect(page.locator("[data-marketing-variant]")).toHaveAttribute("data-marketing-variant", "beta");
  await expect(cta).toHaveAttribute("href", operationalHref!); expect(await authState()).toEqual(before);
  await capture(page, info, "beta-presentation", { operationalHref, authBefore: before, authAfter: await authState() }, hero);
  await gotoStable(page, "/?variant=unknown"); await expect(hero).toContainText("Monthly or yearly Pro subscriptions");
  await expect(page.locator("[data-marketing-variant]")).toHaveAttribute("data-marketing-variant", "production");
  await expect(hero).not.toContainText("Private beta"); await expect(cta).toHaveAttribute("href", operationalHref!);
  expect(await authState()).toEqual(before); await capture(page, info, "default-launch-presentation", { operationalHref, authState: before }, hero);
});
