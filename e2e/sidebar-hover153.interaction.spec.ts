import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";

const key = "edgelab.workspace-sidebar-collapsed.v1";
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const beforeSeal = seal(), errors = new WeakMap<Page, string[]>();
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
    return { width: chart.paneSize().width, range: chart.timeScale().getVisibleLogicalRange(), count: series.data().length };
  });
}
async function sidebarWidth(page: Page) {
  return page.getByRole("complementary", { name: "Workspace navigation" }).evaluate(node => node.getBoundingClientRect().width);
}
function unchanged(actual: Awaited<ReturnType<typeof chartState>>, before: Awaited<ReturnType<typeof chartState>>) {
  expect(actual.width).toBe(before.width);
  expect(actual.range.from).toBeCloseTo(before.range.from, 7);
  expect(actual.range.to).toBeCloseTo(before.range.to, 7);
}

test("transient desktop hover and keyboard expansion preserve chart and saved preference; pin remains explicit", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.addInitScript(key => localStorage.setItem(key, "true"), key);
  const state = await liveViewportSetup(page);
  await expect.poll(async () => (await chartState(page)).count).toBe(600);
  await page.mouse.move(1000, 500);
  await expect.poll(() => sidebarWidth(page)).toBe(76);
  const before = await chartState(page);
  const initialSaved = await page.evaluate(key => localStorage.getItem(key), key);
  expect(initialSaved).toBe("true");
  await page.mouse.move(30, 300);
  await expect.poll(() => sidebarWidth(page)).toBe(252);
  unchanged(await chartState(page), before);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(initialSaved);
  const artifacts = path.resolve(".artifacts/sidebar-hover153", info.project.name); fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, "hover-expanded.png") });
  await page.mouse.move(1000, 500);
  await expect.poll(() => sidebarWidth(page)).toBe(76);
  unchanged(await chartState(page), before);

  await page.mouse.move(30, 300);
  await expect.poll(() => sidebarWidth(page)).toBe(252);
  await page.getByRole("navigation", { name: "Trading workspace" }).getByRole("button", { name: "Live markets", exact: true }).click();
  await page.mouse.move(1000, 500);
  await expect.poll(() => sidebarWidth(page)).toBe(76);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(initialSaved);
  unchanged(await chartState(page), before);

  // Actual keyboard navigation focuses the existing toggle: the expansion must
  // preserve that same DOM node rather than replace a focused compact control.
  await page.evaluate(() => document.getElementById("workspace-content")!.focus());
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => page.getByRole("complementary", { name: "Workspace navigation" }).evaluate(node => node.contains(document.activeElement))).toBe(true);
  const focused = await page.evaluateHandle(() => document.activeElement);
  await expect.poll(() => sidebarWidth(page)).toBe(252);
  expect(await focused.evaluate(node => node === document.activeElement)).toBe(true);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("true");
  unchanged(await chartState(page), before);
  await page.locator("#workspace-content").focus();
  await expect.poll(() => sidebarWidth(page)).toBe(76);

  await page.mouse.move(30, 300);
  await expect.poll(() => sidebarWidth(page)).toBe(252);
  await page.getByRole("button", { name: "Keep workspace navigation expanded", exact: true }).click();
  await page.mouse.move(1000, 500);
  await page.locator("#workspace-content").focus();
  await expect.poll(() => sidebarWidth(page)).toBe(252);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("false");
  await expect(page.getByRole("button", { name: "Collapse workspace navigation", exact: true })).toBeVisible();
  expect(state.events).toEqual([]);
  fs.writeFileSync(path.join(artifacts, "verified-hover.json"), JSON.stringify({ beforeSeal, afterSeal: seal(), before, initialSaved,
    hoverWidth: 252, compactWidth: 76, chartPreservedDuringHover: true, keyboardFocusPreserved: true, mouseFocusDoesNotLatch: true,
    pinnedPreference: await page.evaluate(key => localStorage.getItem(key), key), applicationErrors: errors.get(page) }, null, 2));
});

test("mobile retains the primary workspace without a desktop hover sidebar", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await liveViewportSetup(page);
  await expect(page.getByRole("complementary", { name: "Workspace navigation" })).toBeHidden();
  await expect(page.locator("#workspace-content")).toBeVisible();
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
