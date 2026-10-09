import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor, checkedRun } from "./pine-layering.product-support";

const name = "Heikin-Ashi173";
const source = `//@version=6
indicator("${name}",overlay=false)
offset=input.float(0,"Offset",step=0.5)
ha=ticker.heikinashi(syminfo.tickerid)
[o,h,l,c]=request.security(ha,timeframe.period,[open,high,low,close])
plot(o+offset,"HA open",color=#00ffff)
plot(h+offset,"HA high",color=#ffff00)
plot(l+offset,"HA low",color=#ff00ff)
plot(c+offset,"HA close",color=#ffffff)
shade=c>=o?#28cba4:#fa6575
plotcandle(o+offset,h+offset,l+offset,c+offset,title="HA candles",color=shade,wickcolor=shade,bordercolor=shade)`;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => `${file}:${hash(fs.readFileSync(path.join("frontend/dist", file)))}`).join("\n"));
const hashes = () => Object.fromEntries(["e2e/pine-heikin-ashi173.config.ts", "e2e/pine-heikin-ashi173.interaction.spec.ts"].map(file => [file, hash(fs.readFileSync(file))]));
const initialSeal = seal(), initialHashes = hashes();
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
const titles = ["HA open", "HA high", "HA low", "HA close", "HA candles"];
function oracle(raw: Bar[], offset: number) {
  let previousOpen = 0, previousClose = 0;
  return raw.map((bar, index) => {
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = index ? (previousOpen + previousClose) / 2 : (bar.open + bar.close) / 2;
    previousOpen = open; previousClose = close;
    return { time: bar.time, values: [open, Math.max(bar.high, open, close), Math.min(bar.low, open, close), close].map(value => value + offset) };
  });
}
async function responses(page: Page) {
  return page.evaluate(source => ((window as any).__ha173 ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    return [{ sessionId: payload.sessionId ?? null, sequence: payload.sequence ?? null, inputs: result.inputs, inputDefinitions: result.inputDefinitions, plots: result.plots.map((plot: any) => {
      if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
      const data = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]), arity = plot.packed.arity;
      return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, index) => kinds[index] === 5 ? Array.from(data.slice(index * arity, index * arity + 4)) : kinds[index] === 4 ? data[index * arity] : null).filter((_, index) => kinds[index] !== 0) };
    }) }];
  }), source);
}
async function observed(page: Page, predicate: (result: any) => boolean) {
  await expect.poll(async () => (await responses(page)).some(predicate)).toBe(true);
  return (await responses(page)).findLast(predicate)!;
}
function verifyValues(plots: Array<{ name: string; values: any[] }>, raw: Bar[], offset: number) {
  const expected = oracle(raw, offset); expect(plots.map(plot => plot.name).sort()).toEqual([...titles].sort());
  for (const plot of plots) {
    expect(plot.values).toHaveLength(raw.length); const lane = titles.indexOf(plot.name);
    for (let index = 0; index < expected.length; index++) {
      const values = lane === 4 ? plot.values[index] : [plot.values[index]], targets = lane === 4 ? expected[index].values : [expected[index].values[lane]];
      expect(Array.isArray(values)).toBe(true); expect(values).toHaveLength(targets.length);
      for (let component = 0; component < targets.length; component++) expect(values[component]).toBeCloseTo(targets[component], 8);
    }
  }
}
function verifyResponse(result: any, raw: Bar[], offset: number) {
  expect(result.inputs).toEqual({ in_0: offset }); expect(result.inputDefinitions.map((input: any) => [input.id, input.title, input.type])).toEqual([["in_0", "Offset", "float"]]);
  verifyValues(result.plots, raw, offset);
}
async function rendered(target: Locator) {
  return target.locator("canvas").first().evaluate(node => {
    let chart: any;
    for (let element: Element | null = node; element && !chart; element = element.parentElement) {
      const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
      for (let fiber = key ? (element as any)[key] : null, depth = 0; fiber && depth < 40 && !chart; fiber = fiber.return, depth++) {
        for (let hook = fiber.memoizedState, count = 0; hook && count < 384; hook = hook.next, count++) for (const candidate of [hook.memoizedState?.current, hook.memoizedState?.chart])
          if (typeof candidate?.timeScale === "function" && candidate.chartElement?.().contains(node)) chart = candidate;
      }
    }
    if (!chart) throw Error("Actual native chart unavailable");
    const installed = new Set<any>();
    for (const map of Object.values(chart)) if (map instanceof Map) for (const series of [...map.keys(), ...map.values()])
      if (typeof series?.seriesType === "function" && typeof series.data === "function") installed.add(series);
    const raw = [...installed].filter(series => series.seriesType() === "Candlestick" && !series.options().title).map(series => series.data().map((point: any) => ({ time: point.time, open: point.open, high: point.high, low: point.low, close: point.close })));
    const channels: Array<{ name: string; kind: string; renderer: string; points: Array<{ time: number; value: any }> }> = [];
    for (const series of installed) if (series.options().title) channels.push({ name: series.options().title, kind: series.seriesType(), renderer: "native-series", points: series.data().map((point: any) => ({ time: point.time, value: point.value ?? [point.open, point.high, point.low, point.close] })) });
    const seen = new Set<any>(), queue = [...installed].map(value => ({ value, depth: 0 }));
    for (let index = 0; index < queue.length && index < 10_000; index++) {
      const { value, depth } = queue[index]; if (!value || typeof value !== "object" || seen.has(value)) continue; seen.add(value);
      if (Array.isArray(value.plots) && typeof value.rangeForVisible === "function" && typeof value.paneViews === "function" && value.chart === chart && installed.has(value.series)) {
        for (const plot of value.plots) if (plot.visual?.source) channels.push({ name: plot.name, kind: plot.kind, renderer: "attached-packed-primitive", points: plot.visual.source.points.map((point: any) => ({ time: point.time, value: point.value })) });
        continue;
      }
      if (depth >= 5 || ArrayBuffer.isView(value) || value instanceof Node) continue;
      const children = value instanceof Map || value instanceof Set ? [...value.values()] : Object.values(value);
      for (const child of children) if (child && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
    }
    return { channels, raw };
  });
}
async function verifyRendered(pane: Locator, primary: Locator, raw: Bar[], offset: number) {
  const expected = oracle(raw, offset), tail = expected.at(-1)!;
  await expect.poll(async () => {
    const chart = await rendered(pane);
    return titles.every((name, lane) => { const point = chart.channels.find(channel => channel.name === name)?.points.at(-1); return point?.time === tail.time && (lane === 4 ? point.value.every((value: number, index: number) => Math.abs(value - tail.values[index]) < 1e-8) : Math.abs(point.value - tail.values[lane]) < 1e-8); });
  }).toBe(true);
  const chart = await rendered(pane); verifyValues(chart.channels.map(channel => ({ name: channel.name, values: channel.points.map(point => point.value) })), raw, offset);
  for (const channel of chart.channels) expect(channel.points.map(point => point.time)).toEqual(raw.map(bar => bar.time));
  expect(chart.channels.find(channel => channel.name === "HA candles")?.kind).toBe("candles");
  const rawExpected = raw.map(({ volume, ...bar }) => bar);
  await expect.poll(async () => (await rendered(primary)).raw).toEqual([rawExpected]);
  return { calculated: chart, primary: await rendered(primary) };
}
test.afterEach(async ({ page }, info) => {
  expect(seal()).toBe(initialSeal); expect(hashes()).toEqual(initialHashes);
  if (info.status === info.expectedStatus) return;
  const folder = path.resolve(".artifacts/pine-heikin-ashi173", info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "failure.json"), JSON.stringify({ initialSeal, currentSeal: seal(), initialHashes, responses: await responses(page), body: await page.locator("body").innerText() }, null, 2));
});

test("real Pine HA tuple and candles recur over owned bars while input reruns retain the raw primary chart", async ({ page }, info) => {
  const errors: string[] = [], harnessErrors: string[] = [], workers: any[] = [];
  page.on("pageerror", error => {
    if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") harnessErrors.push(error.message); else errors.push(error.message);
  });
  await page.addInitScript(() => {
    if (window !== window.top) return; (window as any).__ha173 = [];
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__ha173.push(event.data.payload);
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => { const response = await route.fetch(), bytes = await response.body(); workers.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) }); await route.fulfill({ response, body: bytes }); });
  const state = await liveViewportSetup(page), raw = [...state.history], primary = page.locator(".chart-stage").first();
  const dialog = await editor(page); await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source); await checkedRun(dialog);
  const historical = await observed(page, result => !result.sessionId); verifyResponse(historical, raw, 0);
  await expect(dialog.getByRole("spinbutton", { name: "Offset", exact: true })).toHaveValue("0");
  await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === source)).toBe(true);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click(); await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  raw.push(state.emit(600, 67520));
  const first = await observed(page, result => result.sessionId && result.sequence > 0 && result.inputs.in_0 === 0); verifyResponse(first, raw, 0);
  const pane = page.getByRole("region", { name: `${name} native Pine pane`, exact: true }); await expect(pane).toBeVisible(); const firstChart = await verifyRendered(pane, primary, raw, 0);
  await pane.getByRole("button", { name, exact: true }).click();
  const settings = page.getByRole("group", { name: "Indicator settings", exact: true }), offset = settings.getByRole("spinbutton", { name: "Offset", exact: true }); await expect(offset).toHaveValue("0"); await offset.fill("2.5");
  const rerun = await observed(page, result => result.sessionId && result.sessionId !== first.sessionId && result.sequence > 0 && result.inputs.in_0 === 2.5); verifyResponse(rerun, raw, 2.5);
  const rerunChart = await verifyRendered(pane, primary, raw, 2.5), retiredCount = (await responses(page)).filter(result => result.sessionId === first.sessionId).length;
  raw[raw.length - 1] = state.emit(600, 67525);
  const next = await observed(page, result => result.sessionId === rerun.sessionId && result.sequence > rerun.sequence); verifyResponse(next, raw, 2.5);
  const nextChart = await verifyRendered(pane, primary, raw, 2.5); expect((await responses(page)).filter(result => result.sessionId === first.sessionId)).toHaveLength(retiredCount);
  await expect(offset).toHaveValue("2.5"); await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1);
  expect(state.storage.get("custom-indicator-scripts.v1").some((script: any) => script.source === source)).toBe(true);
  const workerName = fs.readdirSync("frontend/dist/assets").find(file => /^pine-native-worker.*\.js$/.test(file))!, worker = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  expect(workers.length).toBeGreaterThan(0); expect(workers.every(item => item.sha256 === hash(worker) && item.bytes === worker.length)).toBe(true); expect(errors).toEqual([]);
  const folder = path.resolve(".artifacts/pine-heikin-ashi173", info.project.name); fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, "custom-input.png") }); await pane.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(folder, "ha-native-chart.png") });
  await settings.getByTitle("Remove indicator", { exact: true }).click(); await expect(pane).toHaveCount(0); await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  fs.writeFileSync(path.join(folder, "receipt.json"), JSON.stringify({ initialSeal, afterSeal: seal(), initialHashes, afterHashes: hashes(), workerName, workerSha256: hash(worker), workers, source, evidence: { historical, first, rerun, next, firstChart, rerunChart, nextChart, retiredCount }, errors, harnessErrors,
    qualification: "Genuine authored Pine editor, production worker, live controller and attached native plot primitive. Auth/storage/provider transport fixtures only. Independent recursive HA formula verifies every tuple lane and candle, actual UTC plot times, input rerun/session retirement, source preservation and raw primary OHLC." }, null, 2));
});
