import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor, checkedRun } from "./pine-layering.product-support";

const name = "Function shadow169";
const source = `//@version=6
indicator("${name}",overlay=false)
const string TF="60"
int value=100
calculate(int value=7)=>
    int result=value
    if true
        int value=value+1
        value:=value+1
        result:=value
    [result,value]
local(string TF)=>
    string result=TF
    if true
        string TF="1"
        TF:="2"
        result:=TF
    result
setting=input.int(7,"Value",minval=1,maxval=20)
[inside,formal]=calculate(setting)
[defaultInner,defaultFormal]=calculate()
plot(close+inside,"Inner",color=#00ffff)
plot(close+formal,"Formal",color=#ff00ff)
plot(close+defaultInner,"Default inner",color=#ffff00)
plot(close+defaultFormal,"Default formal",color=#00ff00)
plot(close+value,"Global",color=#ff8800)
plot(close+(local("1")=="2"?2:-1),"Nested string",color=#ffffff)`;
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const beforeSeal = seal();
const hashes = () => Object.fromEntries(["e2e/pine-function-shadow169.config.ts", "e2e/pine-function-shadow169.interaction.spec.ts"].map(file => [file, hash(fs.readFileSync(file))]));
const beforeHashes = hashes();
const offsets = (value: number) => ({ Inner: value + 2, Formal: value, "Default inner": 9, "Default formal": 7, Global: 100, "Nested string": 2 });

async function results(page: Page) {
  return page.evaluate(source => ((window as any).__shadow169?.results ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    return [{ sessionId: payload.sessionId ?? null, sequence: payload.sequence ?? null, inputs: result.inputs, inputDefinitions: result.inputDefinitions,
      plots: result.plots.map((plot: any) => {
        if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
        const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
        return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? values[i] : kinds[i] === 3 ? true : kinds[i] === 2 ? false : null).filter((_, i) => kinds[i] !== 0) };
      }) }];
  }), source);
}
async function observed(page: Page, predicate: (result: any) => boolean) {
  await expect.poll(async () => (await results(page)).some(predicate)).toBe(true);
  return (await results(page)).findLast(predicate)!;
}
function numericResult(result: any, close: number, value: number) {
  expect(result.inputs).toEqual({ in_0: value });
  expect(result.inputDefinitions.map((input: any) => [input.id, input.title, input.type])).toEqual([["in_0", "Value", "int"]]);
  expect(result.plots.map((plot: any) => plot.name).sort()).toEqual(Object.keys(offsets(value)).sort());
  for (const [name, offset] of Object.entries(offsets(value))) expect(result.plots.find((plot: any) => plot.name === name).values.at(-1)).toBeCloseTo(close + offset, 8);
}
async function chartSeries(pane: Locator) {
  return pane.locator("canvas").first().evaluate(node => {
    // Read existing LWC APIs from the genuine pane. Never install or mutate a
    // series, chart, controller, worker, runtime, or returned result.
    let chart: any;
    for (let element: Element | null = node; element && !chart; element = element.parentElement) {
      const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
      for (let fiber = key ? (element as any)[key] : null, depth = 0; fiber && depth < 40 && !chart; fiber = fiber.return, depth++) {
        for (let hook = fiber.memoizedState, n = 0; hook && n < 384; hook = hook.next, n++) {
          for (const candidate of [hook.memoizedState?.current, hook.memoizedState?.chart]) {
            if (typeof candidate?.timeScale === "function" && candidate.chartElement?.().contains(node)) chart = candidate;
          }
        }
      }
    }
    if (!chart) throw Error("Genuine native pane chart unavailable");
    const installed = new Set<any>();
    for (const map of Object.values(chart)) if (map instanceof Map) {
      for (const series of [...map.keys(), ...map.values()]) if (typeof series?.seriesType === "function" && typeof series.data === "function") installed.add(series);
    }
    const channels: Array<{ name: string; type: string; renderer: string; points: Array<{ time: number; value: number }> }> = [];
    for (const series of installed) if (series.options().title) channels.push({ name: series.options().title, type: series.seriesType(), renderer: "native-series", points: series.data().map((point: any) => ({ time: point.time, value: point.value })) });
    // Packed plots are drawn by the primitive attached to the real LWC host,
    // rather than separate named series. Find that attached renderer through
    // existing SeriesApi/model/wrapper objects, retaining their actual lanes.
    const seen = new Set<any>();
    const queue = [...installed].map(value => ({ value, depth: 0 }));
    for (let index = 0; index < queue.length && index < 10_000; index++) {
      const { value, depth } = queue[index];
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      if (Array.isArray(value.plots) && typeof value.rangeForVisible === "function" && typeof value.paneViews === "function" && value.chart === chart && installed.has(value.series)) {
        for (const plot of value.plots) if (plot.visual?.source) channels.push({ name: plot.name, type: value.series.seriesType(), renderer: "attached-packed-primitive", points: plot.visual.source.points.map((point: any) => ({ time: point.time, value: point.value })) });
        continue;
      }
      if (depth >= 5 || ArrayBuffer.isView(value) || value instanceof Node) continue;
      const children = value instanceof Map || value instanceof Set ? [...value.values()] : Object.values(value);
      for (const child of children) if (child && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
    }
    return channels;
  });
}
async function numericChart(pane: Locator, closes: Map<number, number>, value: number) {
  await expect.poll(async () => {
    const installed = await chartSeries(pane);
    return Object.entries(offsets(value)).every(([name, offset]) => {
      const points = installed.find(series => series.name === name)?.points;
      return points?.length && Math.abs(points.at(-1)!.value - (closes.get(points.at(-1)!.time)! + offset)) < 1e-8;
    });
  }).toBe(true);
  const installed = await chartSeries(pane);
  expect(installed.map(series => series.name).sort()).toEqual(Object.keys(offsets(value)).sort());
  for (const series of installed) {
    expect(series.type).toBe("Line");
    expect(series.points.length).toBeGreaterThanOrEqual(600);
    for (const point of series.points) {
      expect(closes.has(point.time)).toBe(true);
      expect(point.value).toBeCloseTo(closes.get(point.time)! + offsets(value)[series.name as keyof ReturnType<typeof offsets>], 8);
    }
  }
  return installed;
}
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const folder = path.resolve(".artifacts/pine-function-shadow169", info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "failure.json"), JSON.stringify({ results: await results(page), text: await page.locator("body").innerText() }, null, 2));
});

test("real authored v6 function shadowing preserves formal/global bindings and reruns chart input without stale output", async ({ page }, info) => {
  const errors: string[] = [], harnessErrors: string[] = [], workers: any[] = [];
  page.on("pageerror", error => {
    if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") harnessErrors.push(error.message);
    else errors.push(error.message);
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const state: any = { results: [], holdSession: null, held: null }; (window as any).__shadow169 = state;
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (!frame || event.origin !== "null" || event.data?.type !== "result") return;
      state.results.push(event.data.payload);
      if (state.holdSession && event.data.payload?.sessionId === state.holdSession && event.data.payload?.sequence > 0 && event.data.payload?.response?.result?.kind === "run") { state.held = event; event.stopImmediatePropagation(); }
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => {
    const response = await route.fetch(), bytes = await response.body(); workers.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) });
    await route.fulfill({ response, body: bytes });
  });
  const state = await liveViewportSetup(page), closes = new Map(state.history.map(bar => [bar.time, bar.close]));
  const dialog = await editor(page); await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source); await checkedRun(dialog);
  const historical = await observed(page, result => !result.sessionId);
  numericResult(historical, state.history.at(-1)!.close, 7);
  for (const [name, offset] of Object.entries(offsets(7))) expect(historical.plots.find((plot: any) => plot.name === name).values).toEqual(state.history.map(bar => bar.close + offset));
  await expect(dialog.getByRole("spinbutton", { name: "Value", exact: true })).toHaveValue("7");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === source)).toBe(true);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click(); await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const time = state.history.at(-1)!.time + 60;
  closes.set(time, 67520); state.emit(600, 67520);
  const first = await observed(page, result => result.sessionId && result.sequence > 0 && result.inputs.in_0 === 7); numericResult(first, 67520, 7);
  const pane = page.getByRole("region", { name: `${name} native Pine pane`, exact: true }); await expect(pane).toBeVisible();
  const firstSeries = await numericChart(pane, closes, 7);
  await pane.getByRole("button", { name, exact: true }).click();
  const settings = page.getByRole("group", { name: "Indicator settings", exact: true }), value = settings.getByRole("spinbutton", { name: "Value", exact: true });
  await expect(value).toHaveValue("7");
  await page.evaluate(id => { (window as any).__shadow169.holdSession = id; }, first.sessionId);
  closes.set(time, 67521); state.emit(600, 67521);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__shadow169.held))).toBe(true);
  await value.fill("11");
  const rerun = await observed(page, result => result.sessionId && result.sessionId !== first.sessionId && result.sequence > 0 && result.inputs.in_0 === 11); numericResult(rerun, 67521, 11);
  const rerunSeries = await numericChart(pane, closes, 11);
  await page.evaluate(() => { const state = (window as any).__shadow169, held = state.held; state.holdSession = null; state.held = null;
    dispatchEvent(new MessageEvent("message", { data: held.data, origin: held.origin, source: held.source, ports: held.ports })); });
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1);
  await numericChart(pane, closes, 11);
  const retiredCount = (await results(page)).filter(result => result.sessionId === first.sessionId).length;
  closes.set(time, 67522); state.emit(600, 67522);
  const next = await observed(page, result => result.sessionId === rerun.sessionId && result.sequence > rerun.sequence); numericResult(next, 67522, 11);
  const nextSeries = await numericChart(pane, closes, 11);
  expect((await results(page)).filter(result => result.sessionId === first.sessionId)).toHaveLength(retiredCount);
  await expect(value).toHaveValue("11");
  const workerName = fs.readdirSync("frontend/dist/assets").find(file => /^pine-native-worker.*\.js$/.test(file))!, worker = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  expect(workers.length).toBeGreaterThan(0); expect(workers.every(item => item.sha256 === hash(worker) && item.bytes === worker.length)).toBe(true);
  expect(errors).toEqual([]); expect(seal()).toBe(beforeSeal); expect(hashes()).toEqual(beforeHashes);
  const folder = path.resolve(".artifacts/pine-function-shadow169", info.project.name); fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, "function-input-controls.png") });
  await pane.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(folder, "function-native-chart.png") });
  await settings.getByTitle("Remove indicator", { exact: true }).click(); await expect(pane).toHaveCount(0);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  fs.writeFileSync(path.join(folder, "receipt.json"), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeHashes, afterHashes: hashes(), workerName, workerSha256: hash(worker), workers,
    evidence: { historical, first, rerun, next, firstSeries, rerunSeries, nextSeries, retiredCount }, errors, harnessErrors,
    qualification: "Actual production live app/editor/native chart/controller and sealed worker. Auth/storage/provider transport fixtures only. Independently authored numeric offsets applied to provider closes and every plot lane on the real installed native host's attached packed primitive; authentic retired-session response delayed and replayed unchanged." }, null, 2));
});
