import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gotoStable, installDeterminism } from "./support/app";

const artifacts = path.resolve(".artifacts/landing201");
const errors = new WeakMap<Page, string[]>();
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
function buildSeal() {
  const entries = fs.readdirSync("frontend/dist", { recursive: true }).map(String)
    .filter(file => fs.statSync(path.join("frontend/dist", file)).isFile())
    .sort().map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join("frontend/dist", file))) }));
  return { files: entries.length, sha256: hash(JSON.stringify(entries)) };
}
const sealed = buildSeal();
test.beforeEach(({ page }) => {
  errors.set(page, []);
  page.on("pageerror", error => errors.get(page)!.push(error.message));
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(buildSeal()).toEqual(sealed);
});
async function open(page: Page, url = "/") {
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/billing/catalog", route => route.fulfill({ json: {
    provider: "stripe", enabled: false, mode: "live", checkout_available: false,
    reason: "Billing is not configured.",
    plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
  } }));
  await gotoStable(page, url);
  await expect(page.locator("[data-replay-cursor]")).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof (window as any).gsap?.to)).toBe("function");
  await expect.poll(() => page.locator('[data-marketing-reveal="title"]').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
}
async function capture(page: Page, info: TestInfo, name: string, evidence: unknown) {
  const folder = path.join(artifacts, info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify({ sealed, evidence,
    applicationErrors: errors.get(page),
    qualification: "Genuine built marketing DOM, GSAP, chart canvas and 280ms demo stream. Only HTTP presentation/configuration fixtures; this is an illustrative product preview, not an external live-feed claim.",
  }, null, 2));
  await page.screenshot({ path: path.join(folder, `${name}.png`), animations: "allow" });
}
async function headerGeometry(page: Page) {
  return page.locator(".marketing-shell header").evaluate(header => {
    const link = [...header.querySelectorAll("a")].find(node => node.textContent?.trim() === "Sign in")!;
    const rect = link.getBoundingClientRect(), h = header.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, headerBottom: h.bottom,
      viewport: innerWidth, headerWidth: header.clientWidth, headerScrollWidth: header.scrollWidth,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      hit: hit === link || link.contains(hit), href: link.getAttribute("href") };
  });
}

test("Sign in stays visible and usable at every header breakpoint and reaches the real sign-in route", async ({ page }, info) => {
  await open(page);
  const original = page.viewportSize()!;
  const evidence = [];
  for (const width of [...new Set([original.width, 320, 768, 1024])]) {
    await page.setViewportSize({ ...original, width });
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    const link = page.locator(".marketing-shell header").getByRole("link", { name: "Sign in", exact: true });
    await expect(link).toBeVisible();
    const geometry = await headerGeometry(page);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.x + geometry.width).toBeLessThanOrEqual(width);
    expect(geometry.hit).toBe(true);
    expect(geometry.href).toBe("/auth/signin");
    expect(geometry.documentOverflow).toBe(0);
    expect(geometry.headerScrollWidth).toBeLessThanOrEqual(geometry.headerWidth + 1);
    evidence.push({ width, geometry });
  }
  await page.setViewportSize(original);
  const menu = page.getByRole("button", { name: "Open navigation menu", exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  }
  await capture(page, info, "visible-sign-in", { evidence });
  const signIn = page.locator(".marketing-shell header").getByRole("link", { name: "Sign in", exact: true });
  await signIn.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/auth\/signin$/);
  await expect(page.getByRole("button", { name: /Google/ })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test("the real looping chart leads the first viewport and all product scenarios remain available", async ({ page }, info) => {
  await open(page);
  const hero = page.getByRole("region", { name: "Trading workspace preview", exact: true });
  const ink = await hero.locator("canvas").first().evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let up = 0, down = 0, visible = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const candle = (pixels[i] === 38 && pixels[i + 1] === 166 && pixels[i + 2] === 154)
        || (pixels[i] === 239 && pixels[i + 1] === 83 && pixels[i + 2] === 80);
      if (!candle) continue;
      if (pixels[i] === 38) up++; else down++;
      if (rect.top + Math.floor(i / 4 / canvas.width) * rect.height / canvas.height < innerHeight) visible++;
    }
    return { top: rect.top, bottom: rect.bottom, height: rect.height, visibleHeight: Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top),
      up, down, visible, viewport: innerHeight };
  });
  expect(ink.visibleHeight).toBeGreaterThanOrEqual(120);
  expect(ink.visible).toBeGreaterThan(20);
  expect(ink.up).toBeGreaterThan(20);
  expect(ink.down).toBeGreaterThan(20);
  if (info.project.name === "desktop") expect(ink.bottom).toBeLessThanOrEqual(ink.viewport);
  const before = Number(await hero.getAttribute("data-market-last-index"));
  await expect.poll(async () => Number(await hero.getAttribute("data-market-last-index"))).toBeGreaterThan(before + 3);
  expect(await page.locator("main").innerText()).not.toMatch(/qualified data required|implementation timeline|feature roadmap/i);
  await capture(page, info, "chart-first-viewport", { ink, before, after: Number(await hero.getAttribute("data-market-last-index")) });
  for (const label of [/^Journal(?: \+ review)?$/, /^Results$/, /^Replay$/]) {
    await hero.getByRole("button", { name: label }).click();
    await expect(hero.getByRole("button", { name: label })).toHaveAttribute("aria-current", "step");
  }
  const cta = page.locator('[data-marketing-reveal="hero-actions"] a').first();
  await expect(cta).toHaveText("View plans");
  await expect(cta).toHaveAttribute("href", "/pricing");
  await gotoStable(page, "/?variant=beta");
  await expect(cta).toHaveText("Join beta");
  await expect(cta).toHaveAttribute("href", "/auth/signin");
  await expect(page.locator(".marketing-shell header").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
});
async function pose(target: Locator) {
  return target.evaluate(node => {
    const style = getComputedStyle(node), matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
    const rect = node.getBoundingClientRect();
    return { opacity: Number(style.opacity), y: matrix.m42, top: rect.top, bottom: rect.bottom, scrollY,
      headerBottom: document.querySelector(".marketing-shell header")!.getBoundingClientRect().bottom };
  });
}
async function position(target: Locator, where: "below" | "entry" | "exit" | "center") {
  await target.evaluate((node, location) => {
    const rect = node.getBoundingClientRect(), matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform === "none" ? undefined : getComputedStyle(node).transform);
    const headerBottom = document.querySelector(".marketing-shell header")!.getBoundingClientRect().bottom;
    const top = location === "below" ? innerHeight * 1.1 : location === "entry" ? innerHeight * .90
      : location === "exit" ? headerBottom + Math.min(72, Math.max(32, rect.height * .18)) - 8 - rect.height : innerHeight * .45;
    scrollTo({ top: scrollY + rect.top - matrix.m42 - top, behavior: "instant" });
  }, where);
}
async function finished(target: Locator, visible: boolean) {
  await expect.poll(async () => {
    const state = await pose(target);
    return Math.abs(state.opacity - (visible ? 1 : 0)) < .005 && (!visible || Math.abs(state.y) < .01);
  }).toBe(true);
  const before = await pose(target);
  await target.page().waitForTimeout(180);
  const after = await pose(target);
  expect(after.scrollY).toBe(before.scrollY);
  expect(Math.abs(after.y - before.y)).toBeLessThan(.01);
  return after;
}

test("workflow text and rows finish visible enter, exit and reentry after scrolling stops", async ({ page }, info) => {
  await open(page);
  const evidence = [];
  for (const target of [page.locator("#how-it-works .landing-section-title"), page.locator("[data-flow-row]").first()]) {
    await position(target, "below"); await finished(target, false);
    await position(target, "entry"); await page.waitForTimeout(140);
    const entering = await pose(target);
    expect(entering.opacity).toBeGreaterThan(0);
    expect(entering.opacity).toBeLessThan(.99);
    expect(entering.y).toBeGreaterThan(1);
    const entered = await finished(target, true);
    expect(entered.scrollY).toBe(entering.scrollY);
    await position(target, "exit"); await page.waitForTimeout(180);
    const exiting = await pose(target);
    expect(exiting.opacity).toBeGreaterThan(0);
    expect(exiting.opacity).toBeLessThan(.99);
    expect(exiting.y).toBeLessThan(-1);
    expect(exiting.bottom).toBeGreaterThan(exiting.headerBottom);
    const exited = await finished(target, false);
    expect(exited.scrollY).toBe(exiting.scrollY);
    await position(target, "center"); const returned = await finished(target, true);
    evidence.push({ entering, entered, exiting, exited, returned });
  }
  await page.locator("#how-it-works").scrollIntoViewIfNeeded();
  await capture(page, info, "finished-workflow-motion", { evidence });
});
