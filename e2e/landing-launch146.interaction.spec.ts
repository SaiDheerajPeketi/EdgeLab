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
async function openLanding(page: Page, url = "/", reducedMotion: "reduce" | "no-preference" = "no-preference") {
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  // Existing cases require full motion; the preference case retains the real OS seam.
  await page.emulateMedia({ reducedMotion });
  await page.route("**/api/billing/catalog", route => route.fulfill({ json: { provider: "stripe", enabled: false,
    mode: "live", checkout_available: false, reason: "Billing is not configured.",
    plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }] } }));
  await gotoStable(page, url);
  if (reducedMotion === "no-preference") await expect.poll(() => page.evaluate(() => typeof (window as any).gsap?.to)).toBe("function");
}
async function pose(target: Locator) {
  return target.evaluate(node => {
    let opacity = 1, owners = 0;
    for (let current: HTMLElement | null = node as HTMLElement; current; current = current.parentElement) {
      opacity *= Number(getComputedStyle(current).opacity);
      if (current.style.opacity !== "" && current.style.transform !== "") owners++;
    }
    const style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform), rect = node.getBoundingClientRect();
    const headerBottom = document.querySelector(".marketing-shell header")!.getBoundingClientRect().bottom;
    return { opacity, y: matrix.m42, owners, top: rect.top, bottom: rect.bottom, height: rect.height, headerBottom, scrollY, viewport: innerHeight };
  });
}
async function position(target: Locator, location: "below" | "entry" | "tail" | "gone" | "center") {
  await target.evaluate((node, where) => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    const headerBottom = document.querySelector(".marketing-shell header")!.getBoundingClientRect().bottom;
    const desiredTop = where === "below" ? innerHeight * 1.08 : where === "entry" ? innerHeight * .84 :
      where === "tail" ? headerBottom + Math.min(72, Math.max(32, rect.height * .18)) + 24 - rect.height : where === "gone" ? -96 - rect.height : innerHeight / 2 - rect.height / 2;
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
  expect(state.cursor).toBe(state.lastIndex); expect(state.bars.length).toBeGreaterThanOrEqual(16); expect(state.bars.length).toBeLessThanOrEqual(160);
  expect(state.spacing).toBeGreaterThanOrEqual(8); expect(state.spacing).toBeLessThanOrEqual(12);
  expect(state.firstX).toBeLessThanOrEqual(Math.max(6, state.spacing)); expect(state.width - state.lastX).toBeLessThanOrEqual(Math.max(6, state.spacing));
  expect(state.bars.some(bar => bar.close > bar.open)).toBe(true); expect(state.bars.some(bar => bar.close < bar.open)).toBe(true);
  for (let i = 0; i < state.bars.length; i++) {
    const bar = state.bars[i]; expect(Object.values(bar).every(Number.isFinite)).toBe(true);
    expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close)); expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
    if (i) { expect(bar.time - state.bars[i - 1].time).toBe(300); expect(bar.open).toBe(state.bars[i - 1].close); }
  }
}
async function settledChart(target: Locator) {
  // setData and autoSize finish their time-scale layout on the next paint.
  // Observe that real paint without changing market scheduling or edge bounds.
  let state: Awaited<ReturnType<typeof chart>>;
  await expect.poll(async () => {
    state = await chart(target);
    return state.firstX <= Math.max(6, state.spacing) && state.width - state.lastX <= Math.max(6, state.spacing);
  }).toBe(true);
  return state!;
}
const forbidden = /\b96 candles\b|\bone example session\b|\bbars shown\b|\bcandles shown\b|\bfirst candle\b|\blast candle\b|\bgenerated\b|qualified data required|coming soon|implementation timeline|feature roadmap|illustrative (?:market )?data|explore the working example|explore the trading workspace/i;

test("hero contains clean product scenarios and a continuous market without replay or tape transport", async ({ page }, info) => {
  await openLanding(page); const hero = page.locator("[data-replay-cursor]");
  await expect(hero).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Trading workspace preview", exact: true })).toHaveCount(1);
  await expect(page.locator('[data-flow-row] a')).toHaveCount(0);
  await expect(page.locator('main a[href="#live-preview"]')).toHaveCount(1);
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
  const before = await settledChart(hero); continuous(before);
  await expect.poll(async () => (await chart(hero)).cursor).toBeGreaterThan(before.lastIndex + 4);
  const after = await chart(hero); continuous(after); expect(after.bars.at(-1)!.time).toBeGreaterThan(before.bars.at(-1)!.time);
  const overlap = before.bars.filter(bar => after.bars.some(next => next.time === bar.time)); expect(overlap.length).toBeGreaterThan(before.bars.length * .6);
  for (const bar of overlap) expect(after.bars.find(next => next.time === bar.time)).toEqual(bar);
  await capture(page, info, "clean-continuous-hero", { before, after, immutableOverlap: overlap.length, forbiddenPublicCaptions: false }, hero);
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ ...originalViewport, width: 320 }); await hero.scrollIntoViewIfNeeded();
  const narrow = await settledChart(hero); continuous(narrow);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, info, "readable-narrow-candles152", { narrow }, hero);
  await page.setViewportSize(originalViewport); await hero.scrollIntoViewIfNeeded();
  continuous(await settledChart(hero));
  const reduce = page.getByRole("button", { name: /^(Pause|Resume) animations$/ });
  await reduce.click(); await hero.scrollIntoViewIfNeeded(); await page.waitForTimeout(350);
  const paused = await chart(hero); await page.waitForTimeout(850); expect((await chart(hero)).cursor).toBe(paused.cursor);
  await reduce.click(); await hero.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await chart(hero)).cursor).toBeGreaterThan(paused.cursor + 1);
  const resumed = await chart(hero); continuous(resumed);
  await page.locator("#faq").scrollIntoViewIfNeeded(); await page.waitForTimeout(350);
  const offscreen = Number(await hero.getAttribute("data-replay-cursor")); await page.waitForTimeout(850);
  expect(Number(await hero.getAttribute("data-replay-cursor"))).toBe(offscreen);
  await hero.scrollIntoViewIfNeeded(); await expect.poll(async () => Number(await hero.getAttribute("data-replay-cursor"))).toBeGreaterThan(offscreen + 1);
  await capture(page, info, "motion-preference-and-return", { paused: paused.cursor, resumed: resumed.cursor, offscreen, returned: (await chart(hero)).cursor }, hero);
});

test("stopped entry finishes and exits wait until only the final reading strip remains", async ({ page }, info) => {
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

test("text and components visibly travel inside the viewport before finishing without more scroll", async ({ page }, info) => {
  await openLanding(page);
  const evidence = [];
  for (const target of [page.locator("#how-it-works h2"), page.locator('#how-it-works [data-marketing-reveal$="-body"]'), page.locator("[data-flow-row]").first()]) {
    await position(target, "below"); await finished(target, false);
    await target.evaluate(node => {
      const rect = node.getBoundingClientRect(), matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      scrollTo({ top: scrollY + rect.top - matrix.m42 - innerHeight * .90, behavior: "instant" });
    });
    await page.waitForTimeout(140);
    const entering = await pose(target);
    expect(entering.top).toBeLessThan(entering.viewport); expect(entering.bottom).toBeGreaterThan(0);
    expect(entering.opacity).toBeGreaterThan(0); expect(entering.opacity).toBeLessThan(.98); expect(entering.y).toBeGreaterThan(1);
    const entered = await finished(target, true); expect(entered.scrollY).toBe(entering.scrollY);
    await position(target, "tail"); await finished(target, true);
    await target.evaluate(node => {
      const rect = node.getBoundingClientRect(), matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      const headerBottom = document.querySelector(".marketing-shell header")!.getBoundingClientRect().bottom;
      const remaining = headerBottom + Math.min(72, Math.max(32, rect.height * .18)) - 8;
      scrollTo({ top: scrollY + rect.bottom - matrix.m42 - remaining, behavior: "instant" });
    });
    await page.waitForTimeout(180);
    const leaving = await pose(target);
    expect(leaving.bottom).toBeGreaterThan(leaving.headerBottom); expect(leaving.opacity).toBeGreaterThan(0); expect(leaving.opacity).toBeLessThan(.99);
    expect(Math.min(leaving.bottom, leaving.viewport) - Math.max(leaving.top, leaving.headerBottom)).toBeGreaterThan(0);
    expect(leaving.y).toBeLessThan(-1);
    const left = await finished(target, false); expect(left.scrollY).toBe(leaving.scrollY);
    await position(target, "center"); await finished(target, true);
    evidence.push({ tag: await target.evaluate(node => node.tagName), entering, entered, leaving, left });
  }
  await capture(page, info, "visible-scroll-motion", { evidence });
});

test("launch is default and beta marketing CTA changes without mutating auth", async ({ page }, info) => {
  await openLanding(page); const hero = page.locator("[data-landing-hero]");
  await expect(page.locator("[data-marketing-variant]")).toHaveAttribute("data-marketing-variant", "production");
  await expect(page.locator("#pricing")).toContainText("Choose monthly or yearly billing");
  await expect(hero).not.toContainText("Private beta");
  const cta = hero.locator('[data-marketing-reveal="hero-actions"] a').first(); const launchHref = await cta.getAttribute("href");
  await expect(cta).toHaveText(/View plans/); await expect(cta).toHaveAttribute("href", "/pricing");
  const authState = () => page.evaluate(({ auth, google }) => ({ localAuth: localStorage.getItem(auth), sessionAuth: sessionStorage.getItem(auth),
    googleState: sessionStorage.getItem(google), localGoogle: localStorage.getItem(google) }), { auth: AUTH_SESSION_KEY, google: GOOGLE_STATE_KEY });
  const before = await authState();
  await gotoStable(page, "/?variant=beta"); await expect(hero).toContainText("Private beta");
  await expect(page.locator("[data-marketing-variant]")).toHaveAttribute("data-marketing-variant", "beta");
  await expect(cta).toHaveText(/Join beta/); await expect(cta).toHaveAttribute("href", "/auth/signin");
  const betaHref = await cta.getAttribute("href"); expect(betaHref).not.toBe(launchHref); expect(new URL(betaHref!, "https://edgelab.invalid").searchParams.has("variant")).toBe(false);
  expect(await authState()).toEqual(before);
  await capture(page, info, "beta-presentation", { launchHref, betaHref, authBefore: before, authAfter: await authState() }, hero);
  await gotoStable(page, "/?variant=unknown"); await expect(page.locator("#pricing")).toContainText("Choose monthly or yearly billing");
  await expect(page.locator("[data-marketing-variant]")).toHaveAttribute("data-marketing-variant", "production");
  await expect(hero).not.toContainText("Private beta"); await expect(cta).toHaveAttribute("href", launchHref!); await expect(cta).toHaveText(/View plans/);
  expect(await authState()).toEqual(before); await capture(page, info, "default-launch-presentation", { launchHref, betaHref, authState: before }, hero);
});

test("footer motion preference preserves the session choice while the header stays clean", async ({ page }, info) => {
  await openLanding(page, "/", "reduce");
  const shell = page.locator("[data-marketing-motion]");
  const reduce = page.getByRole("button", { name: /^(Pause|Resume) animations$/ }), heading = page.locator("#how-it-works h2");
  const header = page.locator(".marketing-shell header");
  await expect(header.getByRole("button", { name: "Page animations", exact: true })).toHaveCount(0);
  await expect(header).not.toContainText("Animations");
  const headerGeometry = async () => {
    const geometry = await header.evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth, viewport: innerWidth }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    return geometry;
  };
  const preference = () => page.evaluate(() => ({ osReduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    sessionChoice: sessionStorage.getItem("edgelab.marketing.motion.v1") }));
  await expect(shell).toHaveAttribute("data-marketing-motion", "reduced");
  await expect(reduce).toHaveText("Resume animations"); expect(await preference()).toEqual({ osReduced: true, sessionChoice: null });
  await position(heading, "below"); const defaultStatic = await pose(heading);
  expect(defaultStatic.opacity).toBe(1); expect(defaultStatic.y).toBe(0); expect(defaultStatic.owners).toBe(0);

  await reduce.click(); await expect(shell).toHaveAttribute("data-marketing-motion", "full");
  expect(await preference()).toEqual({ osReduced: true, sessionChoice: "full" });
  await position(heading, "below"); await finished(heading, false);
  await position(heading, "entry"); const entered = await finished(heading, true);
  await reduce.click(); await expect(shell).toHaveAttribute("data-marketing-motion", "reduced");
  await position(heading, "below"); const restoredStatic = await pose(heading);
  expect(restoredStatic.opacity).toBe(1); expect(restoredStatic.y).toBe(0); expect(restoredStatic.owners).toBe(0);
  await reduce.click(); await page.reload();
  await expect(shell).toHaveAttribute("data-marketing-motion", "full"); await expect(reduce).toHaveText("Pause animations");
  expect(await preference()).toEqual({ osReduced: true, sessionChoice: "full" });
  await position(heading, "below"); await finished(heading, false);
  await position(heading, "entry"); const reloadedEntry = await finished(heading, true);
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" })); await page.waitForTimeout(1500);
  const originalViewport = page.viewportSize()!, tabletGeometry = [];
  const desktopNavigation = header.locator('nav[aria-label="Primary navigation"]');
  const compactMenu = page.getByRole("button", { name: "Open navigation menu", exact: true });
  await page.setViewportSize({ width: 768, height: originalViewport.height });
  await expect(desktopNavigation).toBeHidden(); await expect(compactMenu).toBeVisible();
  const compactGeometry = await headerGeometry();
  await compactMenu.click(); await expect(page.locator("#marketing-mobile-menu")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.locator("#marketing-mobile-menu")).toHaveCount(0);
  await expect(compactMenu).toBeFocused(); await expect(compactMenu).toHaveAttribute("aria-expanded", "false");
  tabletGeometry.push({ width: 768, compactGeometry, escapeFocusReturned: true });
  await page.setViewportSize({ width: 1024, height: originalViewport.height });
  await expect(desktopNavigation).toBeVisible(); await expect(compactMenu).toBeHidden();
  const desktopGeometry = await headerGeometry();
  const navLines = await desktopNavigation.locator("a").evaluateAll(links => links.map(link => {
    const range = document.createRange(); range.selectNodeContents(link);
    return { text: link.textContent, lines: new Set([...range.getClientRects()].map(rect => rect.top)).size };
  }));
  expect(navLines.length).toBeGreaterThan(0); for (const link of navLines) expect(link.lines).toBe(1);
  tabletGeometry.push({ width: 1024, desktopGeometry, navLines });
  await page.setViewportSize(originalViewport); const finalGeometry = await headerGeometry();
  await capture(page, info, "clean-header153", { defaultStatic, entered, restoredStatic, reloadedEntry,
    finalGeometry, tabletGeometry, preference: await preference() }, header);
});
