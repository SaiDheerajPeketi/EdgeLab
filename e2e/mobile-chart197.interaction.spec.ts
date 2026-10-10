import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";

const root = path.resolve(".artifacts/mobile-chart197");
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const fixtures = ["e2e/mobile-chart197.config.ts", "e2e/mobile-chart197.interaction.spec.ts", "e2e/chart-viewport151.support.ts"];
const fixtureHashes = () => Object.fromEntries(fixtures.map(file => [file, hash(fs.readFileSync(file))]));
function distSeal() {
  const files = fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort();
  return hash(files.map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
}
const beforeDist = distSeal(), beforeFixtures = fixtureHashes();

async function geometry(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".chart-stage");
    if (!stage) throw Error("Actual chart stage missing");
    const key = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    let chart: any, candles: any, pricePrecision: number | undefined;
    for (let fiber = key ? (stage as any)[key] : null, depth = 0; fiber && depth < 64; fiber = fiber.return, depth++) {
      pricePrecision ??= fiber.memoizedProps?.chartSettings?.pricePrecision;
      for (let hook = fiber.memoizedState, n = 0; hook && n < 384; hook = hook.next, n++) {
        const ref = hook.memoizedState?.current;
        if (!chart && typeof ref?.timeScale === "function" && typeof ref?.addCandlestickSeries === "function") chart = ref;
        if (typeof ref?.seriesType === "function" && ref.seriesType() === "Candlestick") candles ??= ref;
      }
    }
    if (!chart || !candles) throw Error("Production chart ownership unavailable");
    const rect = chart.chartElement().getBoundingClientRect(), plot = chart.paneSize();
    const mobileNav = document.querySelector<HTMLElement>('nav[aria-label="Primary workspace"]');
    const nav = mobileNav && getComputedStyle(mobileNav).display !== "none" ? mobileNav.getBoundingClientRect().top : innerHeight;
    const metadata = document.querySelector<HTMLElement>('[data-live-chart-metadata="true"]')!;
    const actions = document.querySelector<HTMLElement>('[data-live-chart-actions="true"]')!;
    return { chart: { x: rect.x, y: rect.y, width: plot.width, height: plot.height, widgetWidth: rect.width, widgetHeight: rect.height, pricePrecision,
      visibleHeight: Math.max(0, Math.min(rect.y + plot.height, nav) - Math.max(0, rect.y)) },
      rows: candles.data().length, scrollY, overflow: document.documentElement.scrollWidth - innerWidth,
      metadata: { height: metadata.getBoundingClientRect().height, wrap: getComputedStyle(metadata).flexWrap, text: metadata.textContent },
      actions: { wrap: getComputedStyle(actions).flexWrap, controls: [...actions.querySelectorAll("button")].map(button => {
        const rect = button.getBoundingClientRect(); return { text: button.textContent?.trim(), width: rect.width, height: rect.height, y: rect.y };
      }) } };
  });
}
async function origin(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await geometry(page)).scrollY).toBe(0);
}
async function settledGeometry(page: Page) {
  let previous = "", since = 0, current: Awaited<ReturnType<typeof geometry>>;
  await expect.poll(async () => {
    current = await geometry(page);
    const next = JSON.stringify(current.chart);
    if (next !== previous) { previous = next; since = Date.now(); return false; }
    return Date.now() - since >= 300;
  }, { intervals: [50], message: "Actual native chart dimensions must settle after panel/fullscreen transitions" }).toBe(true);
  return current!;
}

test("Live chart restores viewport space and retains usable controls and genuine stale-feed warnings", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const state = await liveViewportSetup(page);
  const actions = page.locator('[data-live-chart-actions="true"]');
  const tools = actions.getByRole("button", { name: "Tools", exact: true });
  // Setup chooses the timeframe through the actual toolbar. Measure the user's
  // compact chart state, closing it through its production button.
  if (await page.getByRole("region", { name: "Chart tools", exact: true }).isVisible()) await tools.click();
  await expect(page.getByRole("region", { name: "Chart tools", exact: true })).toBeHidden();
  await expect.poll(async () => (await geometry(page)).rows).toBe(600);
  await origin(page);
  const initial = await settledGeometry(page);
  const folder = path.join(root, info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "initial-geometry.json"), JSON.stringify(initial, null, 2));
  expect(initial.overflow).toBeLessThanOrEqual(1);
  expect(initial.metadata.text).toContain("BTCUSDT");
  expect(initial.metadata.text).toContain("Binance");
  expect(initial.actions.controls.map(item => item.text)).toEqual(["Editor", "Tools", "Settings", "Layers", "Full Screen"]);
  if (info.project.name === "mobile") {
    expect(initial.chart.y).toBeLessThanOrEqual(506); // Prior genuine capture: 606px.
    expect(initial.chart.visibleHeight).toBeGreaterThanOrEqual(280); // Prior: 180px above mobile navigation.
    expect(initial.metadata.wrap).toBe("nowrap"); expect(initial.actions.wrap).toBe("nowrap");
    expect(new Set(initial.actions.controls.map(item => Math.round(item.y))).size).toBe(1);
    for (const control of initial.actions.controls) { expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44); }
  } else {
    expect(initial.chart.height).toBeGreaterThanOrEqual(568);
    expect(initial.chart.width).toBeGreaterThanOrEqual(568);
  }
  await page.screenshot({ path: path.join(folder, "compact-live.png") });

  await actions.getByRole("button", { name: "Editor", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "EdgeLab indicator editor", exact: true });
  await expect(editor).toBeVisible(); await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  await expect(editor).toBeHidden();
  await tools.click(); await expect(page.getByRole("region", { name: "Chart tools", exact: true })).toBeVisible();
  await tools.click(); await expect(page.getByRole("region", { name: "Chart tools", exact: true })).toBeHidden();
  await actions.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Chart settings sections", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close chart settings", exact: true }).click();
  await actions.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Chart objects", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse chart objects", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Chart objects", exact: true })).toBeHidden();
  await actions.getByRole("button", { name: "Full Screen", exact: true }).click();
  await expect(actions.getByRole("button", { name: "Exit", exact: true })).toBeVisible();
  await actions.getByRole("button", { name: "Exit", exact: true }).click();
  await expect(actions.getByRole("button", { name: "Full Screen", exact: true })).toBeVisible();
  await origin(page);
  const restored = await settledGeometry(page);
  fs.writeFileSync(path.join(folder, "restored-geometry.json"), JSON.stringify(restored, null, 2));
  expect(restored.chart.width).toBeCloseTo(initial.chart.width, 0);
  expect(restored.chart.height).toBeCloseTo(initial.chart.height, 0);

  // Only provider receipt time changes; production health policy, status,
  // warning rendering and reconnect controls are untouched.
  await state.waitForAccountWrites();
  await page.route("https://data-api.binance.vision/**/ticker/24hr*", route => route.fulfill({ json: ["BTCUSDT", "ETHUSDT"].map(symbol => ({
    symbol, lastPrice: "67512", priceChange: "1", priceChangePercent: ".1", highPrice: "67600", lowPrice: "67400", volume: "1000",
    quoteVolume: "67500000", openPrice: "67500", closeTime: Date.now() - 180_000,
  })) }));
  await page.reload();
  const warning = page.locator('.ui-critical-state[data-state="stale"]').filter({ has: page.getByRole("heading", { name: "Market data is stale", exact: true }) });
  await expect(warning).toBeVisible(); await expect(warning.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();
  await expect(warning).toContainText("Existing prices remain visible");
  expect(await warning.evaluate(element => element.parentElement!.getBoundingClientRect().height)).toBeGreaterThan(0);
  const stale = await geometry(page); expect(stale.overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]); expect(distSeal()).toBe(beforeDist); expect(fixtureHashes()).toEqual(beforeFixtures);
  fs.writeFileSync(path.join(folder, "receipt.json"), JSON.stringify({ initial, restored, stale, errors, beforeDist, afterDist: distSeal(),
    beforeFixtures, afterFixtures: fixtureHashes(), priorMobileReference: { plotStart: 606, visiblePlotHeight: 180 },
    qualification: "Actual production Live page, native chart refs, real editor/settings/layers/fullscreen controls and health rendering. Auth, operation receipts and provider transport are fixtures only; no component-state replacement or altered stale threshold." }, null, 2));
});
