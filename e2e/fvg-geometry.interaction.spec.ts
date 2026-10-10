import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { productSetup, editor, checkedRun } from "./pine-layering.product-support";
import { replayState } from "./support/replay-context";
import { FROZEN_TIME } from "./support/app";

const source = '//@version=6\nindicator("FVG timeline probe", overlay=true)\nplot(close, title="Earlier timeline", offset=-7, color=color.gray)';
const origin = Date.parse("2026-09-15T00:00:00Z") / 1000;
const bars = Array.from({ length: 600 }, (_, index) => ({ time: origin + index * 60,
  timestamp: new Date((origin + index * 60) * 1000).toISOString(), open: 100, high: 101,
  low: 99, close: 100, volume: 20, ema_20: null, ema_50: null, rsi_14: null }));
for (const [index, open, high, low, close] of [
  [590, 100, 102, 99, 101], [591, 101, 113, 100, 112], [592, 112, 115, 110, 114],
  [593, 114, 114, 111, 112], [594, 100, 101, 96, 98], [595, 98, 101, 95, 97],
  [596, 99, 104, 97, 103],
]) Object.assign(bars[index], { open, high, low, close });
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function seal() {
  const digest = createHash("sha256");
  const files = fs.readdirSync("frontend/dist", { recursive: true }).map(String)
    .filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort();
  for (const file of files) digest.update(file).update("\0").update(createHash("sha256")
    .update(fs.readFileSync(path.join("frontend/dist", file))).digest());
  return { files: files.length, sha256: digest.digest("hex") };
}

// Read production React refs and public LWC coordinates. No chart/series replacement.
async function geometry(page: Page, range?: { from: number; to: number }, union?: "add" | "remove") {
  if (range) {
    const frame = page.locator(".chart-frame").first();
    await frame.scrollIntoViewIfNeeded();
    const box = await frame.locator("canvas").first().boundingBox();
    if (!box) throw Error("Actual plot pointer target unavailable");
    const viewport = page.viewportSize()!;
    await page.mouse.move(box.x + box.width / 2, Math.min(box.y + 40, viewport.height - 130));
    await page.mouse.down();
  }
  let measurement: any;
  try {
    measurement = await page.locator(".chart-stage").first().evaluate(async (stage, { range, union }) => {
    const key = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    let chart: any, series: any;
    for (let fiber = key ? (stage as any)[key] : null, depth = 0; fiber && depth < 64; fiber = fiber.return, depth++) {
      for (let hook = fiber.memoizedState, n = 0; hook && n < 384; hook = hook.next, n++) {
        const ref = hook.memoizedState?.current;
        if (ref && typeof ref.timeScale === "function" && typeof ref.addCandlestickSeries === "function") chart ??= ref;
        if (ref && typeof ref.seriesType === "function" && ref.seriesType() === "Candlestick") series ??= ref;
      }
    }
    if (!chart || !series) throw Error("Actual chart/series refs unavailable");
    const registry = window as any;
    if (union === "add") {
      const first = Number(series.data()[0].time);
      const extra = chart.addLineSeries({ color: "#8b5cf6", lineWidth: 1,
        lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: () => null });
      const times = [1, 2, 3, 4, 5, 6, 7].map(index => first - (8 - index) * 60)
        .concat([588, 590, 592, 594, 596].map(index => Date.parse("2026-09-15T00:00:00Z") / 1000 + index * 60 + 30));
      extra.setData(times.map(time => ({ time, value: 100 })));
      registry.__fvgUnion = { chart, series: extra, times };
    }
    if (union === "remove") {
      if (registry.__fvgUnion?.chart !== chart) throw Error("Union chart owner changed unexpectedly");
      chart.removeSeries(registry.__fvgUnion.series);
      delete registry.__fvgUnion;
    }
    if (range) chart.timeScale().setVisibleLogicalRange(range);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const scale = chart.timeScale(), rows = series.data();
    const rects = [...stage.querySelectorAll("svg g")].flatMap(group => {
      const text = [...group.children].find(node => node.tagName.toLowerCase() === "text");
      const rect = group.firstElementChild;
      if (!text || !/^(Bull|Bear)/.test(text.textContent ?? "") || rect?.tagName.toLowerCase() !== "rect") return [];
      return [{ label: text.textContent, x: Number(rect.getAttribute("x")), y: Number(rect.getAttribute("y")),
        width: Number(rect.getAttribute("width")), height: Number(rect.getAttribute("height")),
        dash: rect.getAttribute("stroke-dasharray"), opacity: Number(rect.getAttribute("stroke-opacity")) }];
    });
    return { unionTimes: registry.__fvgUnion?.times ?? [], unionOwnerCurrent: !registry.__fvgUnion || registry.__fvgUnion.chart === chart, count: rows.length, firstLogical: scale.coordinateToLogical(scale.timeToCoordinate(rows[0].time)),
      latest: rows.at(-1)?.time, range: scale.getVisibleLogicalRange(), spacing: scale.options().barSpacing,
      points: rows.map((row: any) => { const x = scale.timeToCoordinate(row.time);
        return { time: Number(row.time), x, logical: x === null ? null : scale.coordinateToLogical(x) }; }),
      highY: series.priceToCoordinate(110), lowY: series.priceToCoordinate(102), rects };
    }, { range, union });
  } finally {
    if (range) await page.mouse.up();
  }
  // A real pointer release owns the production's finite post-paint scale settling.
  return range ? geometry(page) : measurement;
}
async function jump(page: Page, offset: number) {
  await page.getByRole("button", { name: "Replay options", exact: true }).click();
  const options = page.getByRole("dialog", { name: "Replay options", exact: true });
  await expect(options.getByRole("spinbutton", { name: "Custom replay speed in replay bars per second", exact: true })).toBeFocused();
  const field = options.getByLabel("Replay bar offset", { exact: true });
  await field.fill(String(offset));
  await expect(field).toHaveValue(String(offset));
  const go = options.getByRole("button", { name: "Go", exact: true });
  await expect(go).toBeEnabled();
  await go.click();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await expect.poll(async () => (await geometry(page)).latest).toBe(bars[offset].time);
}
async function addGap(page: Page, label: string) {
  const trigger = page.getByRole("button", { name: "Indicators", exact: true });
  if (!await trigger.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await trigger.click();
  const library = page.getByRole("dialog", { name: "Indicator library", exact: true });
  await library.getByRole("searchbox").fill(label);
  await library.getByRole("button", { name: new RegExp(`^Add (another )?${label} indicator`) }).click();
  await library.getByRole("button", { name: "Close indicator library", exact: true }).click();
  await page.locator(".chart-stage").first().locator(".chart-active-indicator-trigger").click();
  const menu = page.getByRole("dialog", { name: "Active indicators", exact: true });
  await menu.getByRole("button", { name: `Settings for ${label}`, exact: true }).click();
  const settings = page.getByRole("group", { name: "Indicator settings", exact: true });
  const only = settings.getByRole("button", { name: "Only unmitigated", exact: true });
  if (await only.evaluate(node => node.classList.contains("active"))) await only.click();
  await settings.getByRole("button", { name: "Close indicator settings", exact: true }).click();
}
async function checkZone(page: Page, label: RegExp, first: number, last: number, mitigated = false) {
  let result: Awaited<ReturnType<typeof geometry>>;
  try {
    await expect.poll(async () => {
    result = await geometry(page);
    const zone = result.rects.find(rect => label.test(rect.label!));
    const x1 = result.points.find(point => point.time === bars[first].time)?.x;
    const x2 = result.points.find(point => point.time === bars[last].time)?.x;
    if (!zone || x1 == null || x2 == null || result.highY == null || result.lowY == null) return false;
    return Math.abs(zone.x - (x1 - result.spacing / 2)) < 1
      && Math.abs(zone.width - (x2 - x1 + result.spacing)) < 1
      && Math.abs(zone.y - Math.min(result.highY, result.lowY)) < 1
      && Math.abs(zone.height - Math.abs(result.highY - result.lowY)) < 1
      && zone.opacity === (mitigated ? .6 : 1);
    }, { message: "SVG gap must enclose its actual source candles and price interval" }).toBe(true);
  } catch (error) {
    const folder = path.resolve(".artifacts/fvg-geometry", test.info().project.name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `failure-${first}-${last}.json`), JSON.stringify({
      first, last, label: String(label), mitigated, measurement: result!,
    }, null, 2));
    throw error;
  }
  return result!;
}

test("FVG and iFVG use actual shared-timeline candles through replay, pan, zoom, and study removal", async ({ page }, info) => {
  const before = seal(), errors: string[] = [], jumps: number[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let current = 589;
  const state = await productSetup(page, { beforeNavigate: async ({ receipts }) => {
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.replace(/^\/api/, "");
      const owned = endpoint === "/backtests/latest" || endpoint === "/backtests/4101"
        || endpoint === "/backtests/4101/jump" || endpoint === "/market-data/meta" || endpoint === "/market-data/bars";
      if (!owned) return route.fallback();
      const operation = request.headers()["x-edgelab-operation-id"];
      if (operation) {
        expect(receipts.get(operation)).toMatchObject({ method: request.method(), path: endpoint, status: "reserved" });
        Object.assign(receipts.get(operation), { status: "completed", http_status: 200, completed_at: FROZEN_TIME });
      }
      if (endpoint.endsWith("/jump")) { current = request.postDataJSON().offset; jumps.push(current); }
      if (endpoint.startsWith("/backtests/")) {
        const value = replayState();
        return route.fulfill({ json: { ...value, session: { ...value.session, timeframe: "1m", start_offset: 0, end_offset: 599,
          current_offset: current, start_at: bars[0].timestamp, end_at: bars.at(-1)!.timestamp }, current_candle: bars[current] } });
      }
      if (endpoint === "/market-data/meta") return route.fulfill({ json: { csv_path: "/fixtures/FVG/1m.csv", rows: 600,
        first_timestamp: bars[0].timestamp, last_timestamp: bars.at(-1)!.timestamp } });
      const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? 600);
      return route.fulfill({ json: { bars: bars.slice(offset, offset + limit), offset, limit, next_offset: offset + limit } });
    });
  } });
  const dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === source)).toBe(true);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await expect(page.locator(".chart-stage").first().getByRole("button", { name: "FVG timeline probe · Earlier timeline", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  // A real foreign LWC series publishes earlier and sparse timeline timestamps.
  // Native offset plots draw through primitives and do not extend that timeline.
  await geometry(page, undefined, "add");
  await expect.poll(async () => (await geometry(page)).firstLogical).toBeGreaterThanOrEqual(7);
  await addGap(page, "Fair Value Gaps");
  await addGap(page, "Inverse Fair Value Gaps");
  expect((await geometry(page)).rects).toEqual([]);
  await jump(page, 591); expect((await geometry(page)).rects).toEqual([]);
  await jump(page, 592);
  const formation = await checkZone(page, /^Bull(ish)? FVG$/, 590, 592);
  expect(formation.rects.some(rect => /iFVG/.test(rect.label!))).toBe(false);
  const folder = path.resolve(".artifacts/fvg-geometry", info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  await page.locator(".chart-stage").first().screenshot({ path: path.join(folder, "formed-fvg.png") });
  await jump(page, 594); const inversion = await checkZone(page, /^Bear(ish)? iFVG$/, 594, 594);
  await jump(page, 595); const extension = await checkZone(page, /^Bear(ish)? iFVG$/, 594, 595);
  await jump(page, 596); const touch = await checkZone(page, /^Bear(ish)? iFVG$/, 594, 596, true);
  const latestLogical = touch.points.find(point => point.time === bars[596].time)!.logical!;
  await geometry(page, { from: latestLogical - 18, to: latestLogical + 4 });
  const zoomed = await checkZone(page, /^Bull(ish)? FVG$/, 590, 592, true);
  await checkZone(page, /^Bear(ish)? iFVG$/, 594, 596, true);
  await page.locator(".chart-stage").first().screenshot({ path: path.join(folder, "shared-timeline-zoom.png") });
  await geometry(page, { from: latestLogical - 24, to: latestLogical - 2 });
  const panned = await checkZone(page, /^Bull(ish)? FVG$/, 590, 592, true);
  await page.locator(".chart-stage").first().locator(".chart-active-indicator-trigger").click();
  await page.getByRole("dialog", { name: "Active indicators", exact: true })
    .getByRole("button", { name: "Remove FVG timeline probe", exact: true }).click();
  await page.keyboard.press("Escape");
  await geometry(page, undefined, "remove");
  await expect.poll(async () => (await geometry(page)).firstLogical).toBeCloseTo(0, 8);
  const withoutUnion = await geometry(page);
  const removedLatest = withoutUnion.points.find(point => point.time === bars[596].time)!.logical!;
  await geometry(page, { from: removedLatest - 24, to: removedLatest + 4 });
  const removed = await checkZone(page, /^Bull(ish)? FVG$/, 590, 592, true);
  await jump(page, 593);
  await expect.poll(async () => (await geometry(page)).rects.some(rect => /iFVG/.test(rect.label!))).toBe(false);
  await jump(page, 591); await expect.poll(async () => (await geometry(page)).rects.length).toBe(0);
  expect(jumps).toEqual([591, 592, 594, 595, 596, 593, 591]);
  expect(errors).toEqual([]); expect(state.workerReceipts.length).toBeGreaterThan(0); expect(seal()).toEqual(before);
  const workerName = fs.readdirSync("frontend/dist/assets").find(file => /^pine-native-worker.*\.js$/.test(file))!;
  const worker = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  expect(state.workerReceipts.every(receipt => receipt.sha256 === hash(worker) && receipt.bytes === worker.length)).toBe(true);
  fs.writeFileSync(path.join(folder, "receipt.json"), JSON.stringify({ before, after: seal(), formation, inversion, extension,
    touch, zoomed, panned, removed, jumps, errors, workerName, workerSha256: hash(worker), workerReceipts: state.workerReceipts,
    qualification: "Actual production Editor, saved native Pine worker, Replay controls and LWC. Controlled auth/storage/OHLC/session HTTP transport only. Public LWC API adds/removes one genuine earlier/sparse line series and authors precise pan/zoom while a genuine plot pointer is held and released; native offset primitive itself does not extend the shared timeline. No geometry or runtime output substitutes." }, null, 2));
});
