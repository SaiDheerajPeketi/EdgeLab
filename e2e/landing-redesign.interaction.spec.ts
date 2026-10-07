import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { gotoStable, installDeterminism, settlePage } from "./support/app";

const nativeTest = test.extend({ video: "off", trace: "off", screenshot: "off" });
const artifacts = path.resolve(".artifacts/landing-redesign26");

async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}
async function capture(page: Page, name: string, fullPage = false) {
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage, animations: "disabled" });
}
async function opacity(element: Locator) { return element.evaluate((node) => Number(getComputedStyle(node).opacity)); }
async function scroll(page: Page, top: number) { await page.evaluate((position) => window.scrollTo({ top: Math.max(0, position), behavior: "instant" }), top); }

nativeTest("redesign landing chart density, reduced motion and after captures", async ({ page }, info) => {
  await installDeterminism(page);
  await gotoStable(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const stage = page.locator("[data-landing-stage]");
  await stage.scrollIntoViewIfNeeded();
  await expect(stage.locator("canvas").first()).toBeVisible();
  await settlePage(page);
  await capture(page, `after-${info.project.name}-viewport`);
  await capture(page, `after-${info.project.name}-full`, true);
  await stage.screenshot({ path: path.join(artifacts, `after-${info.project.name}-hero.png`), animations: "disabled" });
  const count = Number(await stage.locator("[data-visible-candles]").getAttribute("data-visible-candles"));
  expect(count).toBeGreaterThan(100);
  expect(count).toBeLessThanOrEqual(128);
  const rendered = await stage.locator("canvas").first().evaluate((canvas) => {
    const node = canvas as HTMLCanvasElement, context = node.getContext("2d")!;
    const pixels = context.getImageData(0, 0, node.width, node.height).data;
    const columns = new Set<number>(); let colored = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if ((pixels[index] === 38 && pixels[index + 1] === 166 && pixels[index + 2] === 154) || (pixels[index] === 239 && pixels[index + 1] === 83 && pixels[index + 2] === 80)) { colored += 1; columns.add((index / 4) % node.width); }
    }
    return { colored, columns: columns.size };
  });
  expect(rendered.colored).toBeGreaterThan(100);
  expect(rendered.columns).toBeGreaterThan(80);
  const chartSection = stage.locator('section[aria-label$="chart"]');
  const chartBox = await chartSection.boundingBox();
  const metricBox = await stage.getByText("Net PnL", { exact: true }).boundingBox();
  const workflowBox = await stage.getByRole("heading", { name: "Playbook Control", exact: true }).boundingBox();
  expect(chartBox!.y + chartBox!.height).toBeLessThan(metricBox!.y);
  expect(chartBox!.y + chartBox!.height).toBeLessThan(workflowBox!.y);
  for (const section of ["#how-it-works", "#evidence", "#pricing", "#faq"]) {
    await page.locator(section).scrollIntoViewIfNeeded();
    await expect(page.locator(section)).toBeVisible();
  }
  await page.waitForLoadState("networkidle");
  const staticScenes = await page.locator("[data-scene-content], [data-flow-content]").evaluateAll((nodes) => nodes.map((node) => ({ opacity: getComputedStyle(node).opacity, transform: getComputedStyle(node).transform })));
  expect(staticScenes.every((scene) => scene.opacity === "1" && scene.transform === "none")).toBe(true);
  await settlePage(page);
  await capture(page, `after-${info.project.name}-full`, true);
  await capture(page, `after-${info.project.name}-viewport`);
  await stage.screenshot({ path: path.join(artifacts, `after-${info.project.name}-hero.png`), animations: "disabled" });
  await chartSection.screenshot({ path: path.join(artifacts, `after-${info.project.name}-chart.png`), animations: "disabled" });
  await scroll(page, 0);
  const firstViewCandles = await stage.locator("canvas").first().evaluate((canvas) => {
    const node = canvas as HTMLCanvasElement, box = node.getBoundingClientRect();
    const pixels = node.getContext("2d")!.getImageData(0, 0, node.width, node.height).data;
    const top = Math.max(0, Math.ceil(-box.top * node.height / box.height));
    const bottom = Math.min(node.height, Math.floor((innerHeight - box.top) * node.height / box.height));
    const columns = new Map<number, number[]>(); let colored = 0;
    for (let y = top; y < bottom; y += 1) for (let x = 0; x < node.width; x += 1) {
      const index = (y * node.width + x) * 4;
      if ((pixels[index] === 38 && pixels[index + 1] === 166 && pixels[index + 2] === 154) || (pixels[index] === 239 && pixels[index + 1] === 83 && pixels[index + 2] === 80)) { colored += 1; const rows = columns.get(x) ?? []; rows.push(y); columns.set(x, rows); }
    }
    return { colored, candleColumns: [...columns.values()].filter((rows) => rows.length >= 3 && rows.at(-1)! - rows[0] >= 3).length };
  });
  expect(firstViewCandles.colored).toBeGreaterThan(20);
  expect(firstViewCandles.candleColumns).toBeGreaterThanOrEqual(3);
  await overflow(page);
});

nativeTest("redesign normal motion enters, exits and re-enters in both scroll directions without clipping", async ({ page }, info) => {
  await installDeterminism(page, { motionLock: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await gotoStable(page, "/");
  const scene = page.locator("#how-it-works"), content = scene.locator("[data-scene-content]");
  await expect.poll(() => content.evaluate((node) => node.style.transform)).not.toBe("");
  const geometry = await scene.evaluate((node) => ({ top: node.getBoundingClientRect().top + scrollY, height: node.getBoundingClientRect().height, viewport: innerHeight }));
  const positions = { enter: geometry.top - geometry.viewport + 8, middle: geometry.top + geometry.height / 2 - geometry.viewport / 2, exit: geometry.top + geometry.height - 8 };
  await scroll(page, positions.enter);
  await expect.poll(() => opacity(content)).toBeLessThan(0.95);
  await scroll(page, positions.middle);
  await expect.poll(() => opacity(content)).toBeGreaterThan(0.98);
  await capture(page, `after-${info.project.name}-workflow-motion`);
  const clipped = await scene.locator("h3").evaluateAll((nodes) => nodes.filter((node) => { const box = node.getBoundingClientRect(); return box.top < innerHeight && box.bottom > 0 && (box.left < -1 || box.right > innerWidth + 1); }).map((node) => ({ text: node.textContent, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right })));
  expect(clipped).toEqual([]);
  await overflow(page);
  await scroll(page, positions.exit);
  await expect.poll(() => opacity(content)).toBeLessThan(0.8);
  await scroll(page, positions.middle);
  await expect.poll(() => opacity(content)).toBeGreaterThan(0.98);
  await scroll(page, positions.enter);
  await expect.poll(() => opacity(content)).toBeLessThan(0.95);
  await scroll(page, positions.middle);
  await expect.poll(() => opacity(content)).toBeGreaterThan(0.98);
});

nativeTest("redesign keyboard-focused demo controls stay readable through scroll motion", async ({ page }) => {
  await installDeterminism(page, { motionLock: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await gotoStable(page, "/");
  const stage = page.locator("[data-landing-stage]"), content = stage.locator("[data-scene-content]");
  const buttons = page.getByLabel("Chart to review workflow").getByRole("button");
  await buttons.first().focus();
  await page.keyboard.press("Tab");
  await expect(buttons.nth(1)).toBeFocused();
  await expect.poll(() => opacity(content)).toBe(1);
  await scroll(page, await stage.evaluate((node) => node.getBoundingClientRect().bottom + scrollY));
  await expect.poll(() => opacity(content)).toBe(1);
  await page.keyboard.press("Shift+Tab");
  await expect(buttons.first()).toBeFocused();
  await expect(buttons.first()).toBeInViewport();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(buttons.nth(1)).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Review Notes", { exact: true })).toBeVisible();
});

nativeTest("redesign pricing anchors stay local and mobile navigation remains within the viewport", async ({ page }, info) => {
  await installDeterminism(page);
  await gotoStable(page, "/pricing");
  await expect(page.getByRole("heading", { level: 1, name: "Current access, without fine print." })).toBeVisible();
  await capture(page, `after-${info.project.name}-pricing-full`, true);
  await capture(page, `after-${info.project.name}-pricing-viewport`);
  const mobile = page.viewportSize()!.width < 768;
  if (mobile) {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await capture(page, `after-${info.project.name}-pricing-menu`);
  }
  const nav = page.getByRole("navigation", { name: mobile ? "Mobile navigation" : "Primary navigation", exact: true });
  await expect(nav.getByRole("link", { name: "Pricing", exact: true })).toHaveAttribute("href", "#pricing");
  await expect(nav.getByRole("link", { name: "Evidence", exact: true })).toHaveAttribute("href", "#evidence");
  await expect(nav.getByRole("link", { name: "FAQ", exact: true })).toHaveAttribute("href", "#faq");
  await nav.getByRole("link", { name: "FAQ", exact: true }).click();
  await expect(page).toHaveURL(/\/pricing#faq$/);
  await expect(page.locator("#faq")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Details before access." })).toBeInViewport();
  if (mobile) await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toHaveCount(0);
  await overflow(page);
});

nativeTest("redesign landing CTA and sign-in preserve the requested workspace return", async ({ page }, info) => {
  await installDeterminism(page, { devAuth: true });
  await gotoStable(page, "/?utm_source=redesign&utm_campaign=beta");
  await page.locator("[data-landing-hero]").getByRole("link", { name: "Join beta", exact: true }).click();
  const destination = await page.evaluate(() => new URL(location.href).searchParams.get("from"));
  expect(destination).toBe("/app?utm_source=redesign&utm_campaign=beta");
  const requested = "/app/reports?view=calendar#saved";
  await gotoStable(page, `/auth/signin?from=${encodeURIComponent(requested)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Continue to EdgeLab." })).toBeVisible();
  await capture(page, `after-${info.project.name}-signin-full`, true);
  await capture(page, `after-${info.project.name}-signin-viewport`);
  await overflow(page);
  await page.getByRole("button", { name: "Local development sign-in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${requested.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
});
