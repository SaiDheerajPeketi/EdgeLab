import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { productSetup, editor } from "./pine-layering.product-support";

const artifacts = path.resolve(".artifacts/pine-live-requests143");
const origin = Date.parse("2026-09-15T08:30:00Z") / 1000;
const history = Array.from({ length: 120 }, (_, i) => ({ time: origin + i * 60,
  open: 67500 + i / 10 - 1, high: 67500 + i / 10 + 2, low: 67500 + i / 10 - 2,
  close: 67500 + i / 10, volume: 10 }));
const errors = new WeakMap<Page, string[]>();
const harnessErrors = new WeakMap<Page, string[]>();
const hash = (bytes: crypto.BinaryLike) => crypto.createHash("sha256").update(bytes).digest("hex");
function seal() {
  const entries: string[] = [];
  const visit = (directory: string) => { for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) visit(full); else entries.push(path.relative("frontend/dist", full) + ":" + hash(fs.readFileSync(full)));
  } };
  visit("frontend/dist"); return { files: entries.length, sha256: hash(entries.sort().join("\n")) };
}
const beforeSeal = seal();
const testHashes = () => Object.fromEntries(["e2e/pine-live-requests143.config.ts", "e2e/pine-live-requests143.interaction.spec.ts"]
  .map(file => [file, hash(fs.readFileSync(file))]));
const beforeTestHashes = testHashes();
function source(name: string, overlay = true, dependent = false) {
  return `//@version=6
indicator("${name}",overlay=${overlay},dynamic_requests=true)
factor=input.int(1,"Multiplier",minval=1,maxval=4)
var int ordinary=0
varip int ticks=0
ordinary+=1
ticks+=1
plot(ordinary,"Ordinary",display=display.none)
plot(ticks,"Ticks",display=display.none)
children=request.security_lower_tf(syminfo.tickerid,"1",close)
plot(array.size(children),"Count",display=display.none)
plot(array.sum(children),"Sum",display=display.none)
plot(request.security(syminfo.tickerid,"15",close),"Developing",color=#00ffff)
plot(request.security(syminfo.tickerid,"15",close,gaps=barmerge.gaps_on),"Confirmed",display=display.none)
plot(request.security(syminfo.tickerid,"15",ta.sma(close,2)),"Remote SMA",display=display.none)
plot(array.size(children)>0?array.get(children,array.size(children)-1)*factor:na,"Latest child",color=#ff00ff)
${dependent ? 'plot(chart.left_visible_bar_time,"Left",display=display.none)' : ''}`;
}
const ordinarySource = '//@version=6\nindicator("Ordinary143",overlay=true)\nvarip int ticks=0\nticks+=1\nplot(ticks,"Ticks",display=display.none)\nplot(close,"Price",color=#ffffff)';
async function setup(page: Page) {
  const sockets: any[] = [], providerEvents: any[] = [];
  await page.routeWebSocket(/data-stream\.binance\.vision/, socket => { sockets.push(socket);
    socket.onClose(() => { const index = sockets.indexOf(socket); if (index >= 0) sockets.splice(index, 1); }); });
  const state = await productSetup(page, { target: "/app/live", keepBinanceWebSocket: true, beforeNavigate: async () => {
    await page.route("**/api/live/binance/instruments?**", route => route.fulfill({ json: {
      provider: "binance", instruments: [{ symbol: "BTCUSDT", name: "BTCUSDT", status: "TRADING", asset_class: "crypto", base_asset: "BTC", quote_asset: "USDT", tick_size: .01, min_quantity: .00001, quantity_step: .00001 }], total: 1 } }));
    await page.route("https://data-api.binance.vision/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/klines")) return route.fulfill({ json: url.searchParams.has("endTime") ? [] : history.map(bar =>
        [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), bar.time * 1000 + 59999]) });
      if (url.pathname.endsWith("/ticker/24hr")) return route.fulfill({ json: [{ symbol: "BTCUSDT", lastPrice: "67511.9", priceChange: "1", priceChangePercent: ".1", highPrice: "67600", lowPrice: "67400", volume: "1000", quoteVolume: "67500000", openPrice: "67500", closeTime: Date.parse("2026-09-15T10:30:00Z") }] });
      return route.fulfill({ json: { symbols: [{ symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" }] } });
    });
  } });
  if (!await page.getByRole("button", { name: "5m", exact: true }).first().isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: "5m", exact: true }).first().click();
  await expect.poll(() => sockets.some(socket => socket.url().includes("btcusdt@kline_1m"))).toBe(true);
  let eventTime = Date.parse("2026-09-15T10:30:00Z");
  const emit = (index: number, close: number, confirmed: boolean) => {
    const bar = { time: origin + index * 60, open: 67512, high: Math.max(67530, close + 1), low: 67500, close, volume: 15 };
    const event = { stream: "btcusdt@kline_1m", data: { e: "kline", E: ++eventTime, s: "BTCUSDT", k: {
      t: bar.time * 1000, T: bar.time * 1000 + 59999, i: "1m", s: "BTCUSDT", o: String(bar.open), h: String(bar.high),
      l: String(bar.low), c: String(bar.close), v: String(bar.volume), x: confirmed } } };
    providerEvents.push(event); for (const socket of sockets) if (socket.url().includes("btcusdt@kline_1m")) socket.send(JSON.stringify(event));
    return bar;
  };
  return { state, emit, providerEvents };
}
async function add(page: Page, text: string, state: Awaited<ReturnType<typeof productSetup>>, multiplier?: string) {
  const dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(text);
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  if (multiplier) { const field = dialog.getByLabel("Multiplier", { exact: true }); await field.fill(multiplier); await field.press("Enter"); }
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((item: any) => item.source === text)).toBe(true);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
}
async function results(page: Page, text: string) {
  return page.evaluate(source => ((window as any).__layerResults ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    return [{ ...result, sessionId: payload.sessionId, sequence: payload.sequence, plots: result.plots.map((plot: any) => {
      if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
      const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
      return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? values[i] : kinds[i] === 3 ? true : kinds[i] === 2 ? false : null) };
    }) }];
  }), text);
}
const tail = (result: any, name: string) => result.plots.find((plot: any) => plot.name === name).values.at(-1);
async function observed(page: Page, text: string, close: number, count: number, after = 0) {
  await expect.poll(async () => (await results(page, text)).slice(after).some(result => result.sessionId && tail(result, "Developing") === close && tail(result, "Count") === count)).toBe(true);
  return (await results(page, text)).slice(after).findLast(result => result.sessionId && tail(result, "Developing") === close && tail(result, "Count") === count);
}
async function pan(page: Page) {
  return page.evaluate(async () => {
    const stage = document.querySelector(".chart-stage")!;
    let api: any;
    for (let element: Element | null = stage; element; element = element.parentElement) {
      const key = Object.keys(element).find(value => value.startsWith("__reactFiber$"));
      for (let fiber = key ? (element as any)[key] : null; fiber; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const current = hook.memoizedState?.current;
          if (typeof current?.timeScale === "function" && current.chartElement?.().contains(stage.querySelector("canvas"))) api ??= current;
        }
      }
    }
    if (!api) throw Error("Actual main chart API unavailable");
    api.timeScale().setVisibleLogicalRange({ from: 10, to: 20 });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return api.timeScale().getVisibleLogicalRange();
  });
}
async function save(page: Page, info: TestInfo, name: string, evidence: unknown, state: Awaited<ReturnType<typeof productSetup>>) {
  expect(seal()).toEqual(beforeSeal);
  const directory = path.join(artifacts, info.project.name); fs.mkdirSync(directory, { recursive: true });
  const runtimeFrames = await page.locator('iframe[sandbox="allow-scripts"]').count();
  const afterTestHashes = testHashes(); expect(afterTestHashes).toEqual(beforeTestHashes);
  fs.writeFileSync(path.join(directory, name + ".json"), JSON.stringify({ beforeSeal, afterSeal: seal(), workerReceipts: state.workerReceipts, runtimeFrames, beforeTestHashes, afterTestHashes,
    scope: "Actual production app, saved Pine, native worker and chart; only auth/API/Binance provider transport are controlled.", evidence, errors: errors.get(page), opaquePlaywrightHarnessErrors: harnessErrors.get(page) }, null, 2));
  await page.locator(".chart-stage").first().screenshot({ path: path.join(directory, name + ".png") });
}
test.beforeEach(({ page }) => { const recorded: string[] = []; errors.set(page, recorded); harnessErrors.set(page, []); page.on("pageerror", error => {
  // Opaque isolate Playwright's injected worker emits this harness error; the
  // production runtime does not consume or throw it. Preserve every app error.
  if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") { harnessErrors.get(page)!.push(error.message); return; }
  recorded.push(error.message);
}); });
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test("saved live5m custom study uses real M1 children and developing15m prices through repeated ticks and boundaries", async ({ page }, info) => {
  const { state, emit, providerEvents } = await setup(page), text = source("Live requests143 main");
  await add(page, text, state, "2");
  emit(120, 67520, false);
  const first = await observed(page, text, 67520, 1);
  expect(first.inputs.in_0).toBe(2); expect(tail(first, "Latest child")).toBe(135040);
  expect(tail(first, "Remote SMA")).toBeCloseTo((67511.9 + 67520) / 2, 8);
  const ticks = tail(first, "Ticks"), sequence = first.sequence;
  emit(120, 67525, false);
  const revised = await observed(page, text, 67525, 1);
  expect(revised.sessionId).toBe(first.sessionId); expect(revised.sequence).toBeGreaterThan(sequence);
  expect(tail(revised, "Sum")).toBe(67525); expect(tail(revised, "Ticks")).toBe(ticks + 1);
  emit(120, 67525, false);
  await expect.poll(async () => (await results(page, text)).some(result => result.sessionId === first.sessionId && tail(result, "Ticks") === ticks + 2)).toBe(true);
  let latest = revised;
  for (let index = 120; index < 135; index++) {
    const close = index === 120 ? 67525 : 67520 + (index - 120);
    if (index > 120) { const before = (await results(page, text)).length; emit(index, close, false); latest = await observed(page, text, close, index % 5 + 1, before); }
    const before = (await results(page, text)).length; emit(index, close, true);
    latest = await observed(page, text, close, index % 5 + 1, before);
    expect(tail(latest, "Confirmed")).toBe(index === 134 ? close : null);
  }
  emit(135, 67540, false);
  const next = await observed(page, text, 67540, 1);
  expect(tail(next, "Remote SMA")).toBeCloseTo((67534 + 67540) / 2, 8);
  expect(next.sessionId).toBe(first.sessionId); expect(next.audit.bars).toBe(28);
  await save(page, info, "main-live-requests", { first, revised, lastConfirmed: latest, next, providerEvents }, state);
});

test("native pane viewport rerun keeps latest M1 source and ordinary session then removes its owned runtime", async ({ page }, info) => {
  const { state, emit, providerEvents } = await setup(page), text = source("Live requests143 pane", false, true);
  await add(page, ordinarySource, state); await add(page, text, state);
  emit(120, 67520, false);
  const first = await observed(page, text, 67520, 1);
  await expect.poll(async () => (await results(page, ordinarySource)).some(result => result.sessionId)).toBe(true);
  const ordinary = (await results(page, ordinarySource)).findLast(result => result.sessionId);
  emit(120, 67525, false);
  const revised = await observed(page, text, 67525, 1);
  await expect.poll(async () => (await results(page, ordinarySource)).some(result => result.sessionId === ordinary.sessionId && result.sequence > ordinary.sequence)).toBe(true);
  const ordinaryBefore = (await results(page, ordinarySource)).at(-1), before = (await results(page, text)).length;
  const range = await pan(page);
  await expect.poll(async () => (await results(page, text)).slice(before).some(result => result.sessionId === revised.sessionId && result.sequence > revised.sequence)).toBe(true);
  const rerun = (await results(page, text)).slice(before).findLast(result => result.sessionId === revised.sessionId);
  expect(tail(rerun, "Sum")).toBe(67525); expect(tail(rerun, "Count")).toBe(1);
  expect(tail(rerun, "Latest child")).toBe(67525); expect(rerun.audit.bars).toBe(25);
  expect((await results(page, ordinarySource)).at(-1)).toEqual(ordinaryBefore);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(2);
  await save(page, info, "pane-source-viewport-before-removal", { first, revised, rerun, range, ordinaryBefore, providerEvents }, state);
  const trigger = page.locator(".chart-study-pill").filter({ hasText: "Live requests143 pane" });
  await trigger.first().click();
  const settings = page.getByRole("group", { name: "Indicator settings", exact: true });
  await settings.getByTitle("Remove indicator", { exact: true }).click();
  await expect(trigger).toHaveCount(0);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1);
  const afterRemoval = (await results(page, text)).length;
  emit(120, 67526, false);
  await expect.poll(async () => (await results(page, ordinarySource)).some(result => result.sessionId === ordinaryBefore.sessionId
    && result.sequence > ordinaryBefore.sequence && tail(result, "Price") === 67526)).toBe(true);
  expect((await results(page, text)).length).toBe(afterRemoval);
  await save(page, info, "pane-source-viewport-owner", { first, revised, rerun, range, ordinaryBefore, providerEvents, afterRemoval }, state);
});
