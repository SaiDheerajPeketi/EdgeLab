import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";

const artifacts = path.resolve(".artifacts/chart-viewport151");
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
function seal() {
  const files = fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile());
  return { files: files.length, sha256: hash(files.sort().map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n")) };
}
const beforeSeal = seal(), files = ["e2e/chart-viewport151.config.ts", "e2e/chart-viewport151.support.ts", "e2e/chart-viewport151.interaction.spec.ts"];
const hashes = () => Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(file))]));
const beforeHashes = hashes(), applicationErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { applicationErrors.set(page, []); page.on("pageerror", error => applicationErrors.get(page)!.push(error.message)); });
test.afterEach(({ page }) => { expect(applicationErrors.get(page)).toEqual([]); expect(seal()).toEqual(beforeSeal); expect(hashes()).toEqual(beforeHashes); });

// Read the actual chart and series from their production React-owned refs. Only
// public LWC viewport methods perform the authored pan/zoom; no product hooks.
async function readChart(page: Page, pane = 0, range?: { from: number; to: number }, remember = false) {
  return page.evaluate(async ({ pane, range, remember }) => {
    const stage = document.querySelectorAll<HTMLElement>(".chart-stage")[pane];
    if (!stage) throw Error("Production chart stage unavailable");
    const key = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    let api: any, candles: any, volume: any, navigation: any, initializer: any;
    for (let fiber = key ? (stage as any)[key] : null, depth = 0; fiber && depth < 64; fiber = fiber.return, depth++) {
      for (let hook = fiber.memoizedState, n = 0; hook && n < 384; hook = hook.next, n++) {
        const ref = hook.memoizedState?.current;
        if (!ref) continue;
        if (!api && typeof ref.timeScale === "function" && typeof ref.addCandlestickSeries === "function") api = ref;
        if (typeof ref.seriesType === "function") { if (ref.seriesType() === "Candlestick") candles ??= ref; if (ref.seriesType() === "Histogram") volume ??= ref; }
        if (typeof ref.following === "boolean" && "anchorTime" in ref && "expected" in ref) navigation ??= ref;
        if (typeof ref.retry === "function" && typeof ref.adopt === "function" && "pending" in ref) initializer ??= ref;
      }
    }
    if (!api || !candles) throw Error("Actual production chart/series refs unavailable");
    if (range) api.timeScale().setVisibleLogicalRange(range);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const owners = (window as any).__viewport151Owners ??= {};
    if (remember) owners[pane] = { api, candles, volume };
    const owner = owners[pane], scale = api.timeScale(), plot = api.paneSize(), rect = api.chartElement().getBoundingClientRect();
    const rows = candles.data().map((bar: any) => ({ time: Number(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close }));
    const positions = rows.map((bar: any) => { const x = scale.timeToCoordinate(bar.time); return { time: bar.time, x,
      logical: x === null ? null : scale.coordinateToLogical(x) }; });
    return { rows, positions, volume: (volume?.data() ?? []).map((bar: any) => ({ time: Number(bar.time), value: bar.value })),
      logical: scale.getVisibleLogicalRange(), time: scale.getVisibleRange(), spacing: scale.options().barSpacing,
      navigation: navigation ? { following: navigation.following, range: navigation.range && { from: navigation.range.from, to: navigation.range.to },
        expected: navigation.expected && { from: navigation.expected.from, to: navigation.expected.to }, anchorTime: navigation.anchorTime,
        anchorLogical: navigation.anchorLogical, gap: navigation.gap, followGap: navigation.followGap,
        baseLogical: navigation.baseLogical, adoptingLinked: navigation.adoptingLinked } : null,
      initializerPending: initializer?.pending ?? null,
      plot: { x: rect.x, y: rect.y, width: plot.width, height: plot.height },
      ownersUnchanged: !owner || owner.api === api && owner.candles === candles && owner.volume === volume };
  }, { pane, range, remember });
}
type Chart = Awaited<ReturnType<typeof readChart>>;
async function settled(page: Page, pane = 0, stableFor = 200) {
  let previous = "", stableSince = 0, current: Chart;
  await expect.poll(async () => {
    current = await readChart(page, pane);
    const next = JSON.stringify([current.logical, current.plot.width]);
    if (next !== previous) { previous = next; stableSince = Date.now(); return false; }
    return Date.now() - stableSince >= stableFor;
  }, { intervals: [50] }).toBe(true);
  return current!;
}
function sameRange(actual: Chart, expected: Chart) {
  expect(actual.logical.from).toBeCloseTo(expected.logical.from, 8); expect(actual.logical.to).toBeCloseTo(expected.logical.to, 8);
  expect(actual.spacing).toBeCloseTo(expected.spacing, 8); expect(actual.ownersUnchanged).toBe(true);
}
function usefulLatest(chart: Chart) {
  expect(chart.rows.length).toBeGreaterThan(0);
  const last = chart.positions.at(-1)!;
  expect(last.x).toBeGreaterThan(0); expect(last.x).toBeLessThan(chart.plot.width);
  expect(chart.logical.to - last.logical).toBeCloseTo(8, 6);
  const span = chart.logical.to - chart.logical.from;
  expect(span).toBeGreaterThanOrEqual(96 - 1e-6); expect(span).toBeLessThanOrEqual(320 + 1e-6);
  expect(span).toBeCloseTo(Math.min(320, Math.max(96, Math.round(chart.plot.width / 6))), 6);
}
async function updated(page: Page, count: number, close: number, pane = 0) {
  await expect.poll(async () => { const chart = await readChart(page, pane); return chart.rows.length === count && chart.rows.at(-1)?.close === close; }).toBe(true);
  return settled(page, pane);
}
async function save(page: Page, info: TestInfo, name: string, evidence: unknown, state: Awaited<ReturnType<typeof liveViewportSetup>>) {
  const folder = path.join(artifacts, info.project.name); fs.mkdirSync(folder, { recursive: true });
  expect(seal()).toEqual(beforeSeal); expect(hashes()).toEqual(beforeHashes);
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeHashes, afterHashes: hashes(),
    applicationErrors: applicationErrors.get(page), providerEvents: state.events, requests: state.requests, evidence,
    qualification: "Actual production Live/Replay chart, LWC refs and public viewport API. Current-time auth/storage/provider/normalized HTTP transport fixtures only. No chart/controller replacements, timer acceleration or fake runtime results. Live range linking is unavailable; linked-range proof explicitly uses Replay." }, null, 2));
  await page.locator(".chart-stage").first().screenshot({ path: path.join(folder, name + ".png") });
}

test("delayed live history initializes useful density and detached pan zoom survive candle and volume updates", async ({ page }, info) => {
  const state = await liveViewportSetup(page, true);
  expect((await readChart(page)).rows).toEqual([]);
  state.emit(600, 67520);
  await updated(page, 1, 67520); state.releaseHistory();
  const initialized = await updated(page, 601, 67520); usefulLatest(initialized);
  await readChart(page, 0, undefined, true);
  const near = await readChart(page, 0, { from: 530, to: 602 });
  expect(near.positions.at(-1)!.x).toBeGreaterThan(0); expect(near.positions.at(-1)!.x).toBeLessThan(near.plot.width);
  expect(near.logical.to - near.positions.at(-1)!.logical).toBeCloseTo(2, 6);
  state.emit(600, 67522, false, 23); const tick = await updated(page, 601, 67522); sameRange(tick, near);
  expect(tick.volume.at(-1)).toMatchObject({ value: 23 });
  state.emit(600, 67522, false, 27);
  await expect.poll(async () => (await readChart(page)).volume.at(-1)?.value).toBe(27);
  const volumeOnly = await settled(page); sameRange(volumeOnly, near);
  state.emit(600, 67522, true, 27); await updated(page, 601, 67522);
  state.emit(601, 67524, false, 31); const appended = await updated(page, 602, 67524); sameRange(appended, near);
  expect(appended.positions.find(point => point.time === near.rows[590].time)!.x).toBeCloseTo(near.positions[590].x, 6);
  const older = await readChart(page, 0, { from: 220, to: 270 });
  state.emit(601, 67526, false, 34); const olderTick = await updated(page, 602, 67526); sameRange(olderTick, older);
  let nativeGesture: unknown = null;
  if (info.project.name === "desktop") {
    await page.locator(".chart-stage").first().scrollIntoViewIfNeeded();
    const beforeGesture = await readChart(page), { plot } = beforeGesture;
    const point = { x: plot.x + plot.width * .5, y: plot.y + plot.height * .12 };
    const hit = () => page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return { canvas: element?.tagName === "CANVAS", toolbar: Boolean(element?.closest(".indicator-floating-toolbar")) };
    }, point);
    const beforeHit = await hit(); expect(beforeHit).toEqual({ canvas: true, toolbar: false });
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 100, point.y, { steps: 6 }); await page.mouse.up();
    const dragged = await settled(page); expect(Math.abs(dragged.logical.from - olderTick.logical.from)).toBeGreaterThan(1);
    await page.mouse.move(point.x, point.y); const wheelHit = await hit(); expect(wheelHit).toEqual({ canvas: true, toolbar: false });
    await page.mouse.wheel(0, -180); const zoomed = await settled(page);
    expect(zoomed.logical.to - zoomed.logical.from).toBeLessThan(dragged.logical.to - dragged.logical.from);
    state.emit(601, 67528, false, 38); const afterGesture = await updated(page, 602, 67528); sameRange(afterGesture, zoomed);
    nativeGesture = { beforeGesture, point, beforeHit, wheelHit, dragged, zoomed, afterGesture };
  } else {
    await page.locator(".chart-stage").first().scrollIntoViewIfNeeded();
    const beforeTouch = await readChart(page), { plot } = beforeTouch;
    const viewport = page.viewportSize()!, startX = plot.x + plot.width * .65;
    const y = Math.max(20, Math.min(viewport.height - 32, plot.y + plot.height * .45));
    expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".chart-stage")), { x: startX, y })).toBe(true);
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y }] });
    for (let step = 1; step <= 6; step++) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: startX - plot.width * .35 * step / 6, y }] });
      await page.waitForTimeout(18);
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await touch.detach();
    const flicked = await settled(page, 0, 750);
    expect(Math.abs(flicked.logical.from - beforeTouch.logical.from)).toBeGreaterThan(1);
    await page.waitForTimeout(650); const afterInertia = await readChart(page); sameRange(afterInertia, flicked);
    state.emit(601, 67528, false, 38); const afterGesture = await updated(page, 602, 67528); sameRange(afterGesture, flicked);
    nativeGesture = { beforeTouch, flicked, afterInertia, afterGesture,
      qualification: "Actual Chromium touch input, six native move events then release; real-time inertia settles for 750 ms and remains stable beyond 500 ms. No controller or timer replacement." };
  }
  const resetBefore = await readChart(page);
  await page.mouse.click(resetBefore.plot.x + resetBefore.plot.width * .5, resetBefore.plot.y + resetBefore.plot.height * .5, { button: "right" });
  await page.getByRole("menuitem", { name: "Reset chart view", exact: true }).click();
  const reset = await settled(page); usefulLatest(reset);
  await save(page, info, "detached-and-reset", { initialized, near, tick, volumeOnly, appended, older, olderTick, nativeGesture, reset }, state);
});

test("live edge follows append without zoom jump and immediate timeframe ticks cannot cancel initialization", async ({ page }, info) => {
  const state = await liveViewportSetup(page);
  await expect.poll(async () => (await readChart(page)).rows.length).toBe(600);
  const initial = await settled(page); usefulLatest(initial); await readChart(page, 0, undefined, true);
  state.emit(600, 67520); const open = await updated(page, 601, 67520);
  expect(open.logical.from - initial.logical.from).toBeCloseTo(1, 6); expect(open.logical.to - initial.logical.to).toBeCloseTo(1, 6);
  expect(open.spacing).toBeCloseTo(initial.spacing, 6); expect(open.positions.at(-1)!.x).toBeCloseTo(initial.positions.at(-1)!.x, 6);
  state.emit(600, 67521, true); const closed = await updated(page, 601, 67521); sameRange(closed, open);
  state.emit(601, 67524); const append = await updated(page, 602, 67524);
  expect(append.logical.from - open.logical.from).toBeCloseTo(1, 6); expect(append.logical.to - open.logical.to).toBeCloseTo(1, 6);
  expect(append.spacing).toBeCloseTo(open.spacing, 6); usefulLatest(append);
  await page.getByRole("button", { name: "5m", exact: true }).first().click();
  state.emit(601, 67526, false, 25); state.emit(601, 67528, false, 28);
  const chartBars = new Set([...state.history.map(bar => Math.floor(bar.time / 300)), ...state.events.map(event => Math.floor(event.data.k.t / 300_000))]).size;
  const changed = await updated(page, chartBars, 67528); usefulLatest(changed);
  expect(changed.rows.length).toBeGreaterThanOrEqual(120); expect(changed.rows.length).toBeLessThanOrEqual(122);
  expect(changed.ownersUnchanged).toBe(true);
  const fiveMinuteManual = await readChart(page, 0, { from: 30, to: 75 });
  state.emit(601, 67529, false, 30); const fiveMinuteTick = await updated(page, chartBars, 67529); sameRange(fiveMinuteTick, fiveMinuteManual);
  await save(page, info, "live-edge-and-timeframe", { initial, open, closed, append, changed, chartBars, fiveMinuteManual, fiveMinuteTick }, state);
});

test("Replay linked range received while normalized target is empty survives its delayed first data", async ({ page }, info) => {
  const state = await liveViewportSetup(page, false, "/app/replay");
  await expect.poll(async () => (await readChart(page)).rows.length).toBe(600);
  const toolbar = page.locator(".chart-studio-toolbar"); await toolbar.getByRole("button", { name: "Workspace", exact: true }).click();
  const workspace = page.getByRole("dialog", { name: "Workspace controls", exact: true });
  await workspace.getByRole("radio", { name: "2 rows", exact: true }).click(); await page.keyboard.press("Escape");
  await expect(page.locator(".chart-stage")).toHaveCount(2);
  await page.getByRole("button", { name: "Pane 2", exact: true }).click();
  const symbol = toolbar.getByRole("combobox", { name: "Chart symbol", exact: true }); await symbol.fill("ETHUSDT");
  await page.getByRole("option").filter({ hasText: "ETHUSDT" }).first().click();
  await page.getByRole("button", { name: "1m", exact: true }).first().click();
  await expect.poll(() => state.requests.some(request => request.kind === "normalized" && request.url.includes("/2/candles"))).toBe(true);
  expect((await readChart(page, 1)).rows).toEqual([]);
  await page.getByRole("button", { name: "Pane 1", exact: true }).click();
  const source = await readChart(page, 0, { from: 220, to: 285 });
  state.releaseNormalized();
  await expect.poll(async () => (await readChart(page, 1)).rows.length).toBe(600);
  const target = await settled(page, 1);
  expect(target.time).toEqual(source.time);
  expect(target.logical.from).toBeCloseTo(source.logical.from, 6); expect(target.logical.to).toBeCloseTo(source.logical.to, 6);
  const stableSource = await settled(page); sameRange(stableSource, source);
  const second = await readChart(page, 0, { from: 300, to: 335 });
  await expect.poll(async () => (await readChart(page, 1)).time).toEqual(second.time);
  const targetSecond = await settled(page, 1);
  expect(targetSecond.logical.from).toBeCloseTo(second.logical.from, 6); expect(targetSecond.logical.to).toBeCloseTo(second.logical.to, 6);
  await save(page, info, "replay-pending-linked-range", { source, target, stableSource, second, targetSecond,
    qualification: "Replay supports linked ranges. Live currently lacks range-sync callback wiring; no Live linking is claimed." }, state);
});
