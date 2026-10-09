import { expect, test, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor, checkedRun } from "./pine-layering.product-support";
import { selectPineCatalogScript } from "./support/pine-catalog-selection";
import { PINE_INDICATOR_STARTERS } from "../frontend/src/lib/pineStarters";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => `${file}:${hash(fs.readFileSync(path.join("frontend/dist", file)))}`).join("\n"));
const hashes = () => Object.fromEntries(["e2e/pine-starters174.config.ts", "e2e/pine-starters174.interaction.spec.ts", "frontend/src/lib/pineStarters.ts"].map(file => [file, hash(fs.readFileSync(file))]));
const initialSeal = seal(), initialHashes = hashes();
const expected = [
  { id: "pine-macd", name: "MACD", overlay: false, inputs: [["Source", "source"], ["Fast length", "int"], ["Slow length", "int"], ["Signal length", "int"]], numbers: [null, 12, 26, 9], plots: ["Histogram", "MACD", "Signal", "Zero"] },
  { id: "pine-bollinger", name: "Bollinger Bands", overlay: true, inputs: [["Source", "source"], ["Length", "int"], ["Standard deviations", "float"]], numbers: [null, 20, 2], plots: ["Basis", "Upper", "Lower"] },
  { id: "pine-donchian", name: "Donchian Channel", overlay: true, inputs: [["Length", "int"]], numbers: [20], plots: ["Midpoint", "Upper", "Lower"] },
  { id: "pine-ichimoku", name: "Ichimoku Cloud", overlay: true, inputs: [["Conversion length", "int"], ["Base length", "int"], ["Span B length", "int"], ["Displacement", "int"]], numbers: [9, 26, 52, 26], plots: ["Conversion", "Base", "Span A", "Span B", "Lagging close"] },
  { id: "pine-vwap", name: "UTC Daily VWAP", overlay: true, inputs: [["Source", "source"]], numbers: [null], plots: ["VWAP"] },
  { id: "pine-heikin-ashi", name: "Heikin-Ashi Candles", overlay: false, inputs: [["Up color", "color"], ["Down color", "color"]], numbers: [null, null], plots: ["Heikin-Ashi"] },
];
const catalog = JSON.parse(fs.readFileSync("frontend/src/lib/pineCatalogManifestV2.json", "utf8"));
const attributed = catalog.entries.find((entry: any) => entry.name === "Parabolic SAR");
function chartCopies(value: any): any[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(chartCopies);
  if (value.kind === "custom" && typeof value.customScriptSource === "string") return [value];
  return Object.values(value).flatMap(chartCopies);
}
async function responses(page: Page) {
  return page.evaluate(() => ((window as any).__starters174 ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || !result) return [];
    return [{ ...result, sessionId: payload.sessionId ?? null, sequence: payload.sequence ?? null, plots: result.plots?.map((plot: any) => {
      if (!plot.packed) return { ...plot, values: plot.points.map((point: any) => point.value) };
      const data = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]), arity = plot.packed.arity;
      return { id: plot.id, name: plot.name, style: plot.style, values: Array.from({ length: plot.packed.slots }, (_, index) => kinds[index] === 5 ? Array.from(data.slice(index * arity, index * arity + 4)) : kinds[index] === 4 ? data[index * arity] : null).filter((_, index) => kinds[index] !== 0) };
    }) }];
  }));
}
async function observed(page: Page, source: string, predicate = (result: any) => result.kind === "run" && !result.sessionId) {
  await expect.poll(async () => (await responses(page)).some(result => result.source === source && predicate(result))).toBe(true);
  return (await responses(page)).findLast(result => result.source === source && predicate(result))!;
}
async function rendered(pane: Locator) {
  return pane.locator("canvas").first().evaluate(node => {
    let chart: any;
    for (let element: Element | null = node; element && !chart; element = element.parentElement) {
      const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
      for (let fiber = key ? (element as any)[key] : null, depth = 0; fiber && depth < 40 && !chart; fiber = fiber.return, depth++) {
        for (let hook = fiber.memoizedState, count = 0; hook && count < 384; hook = hook.next, count++) for (const candidate of [hook.memoizedState?.current, hook.memoizedState?.chart])
          if (typeof candidate?.timeScale === "function" && candidate.chartElement?.().contains(node)) chart = candidate;
      }
    }
    if (!chart) throw Error("Actual native MACD chart unavailable");
    const installed = new Set<any>();
    for (const map of Object.values(chart)) if (map instanceof Map) for (const series of [...map.keys(), ...map.values()])
      if (typeof series?.seriesType === "function" && typeof series.data === "function") installed.add(series);
    const channels: any[] = [], seen = new Set<any>(), queue = [...installed].map(value => ({ value, depth: 0 }));
    for (let index = 0; index < queue.length && index < 10_000; index++) {
      const { value, depth } = queue[index]; if (!value || typeof value !== "object" || seen.has(value)) continue; seen.add(value);
      if (Array.isArray(value.plots) && typeof value.rangeForVisible === "function" && typeof value.paneViews === "function" && value.chart === chart && installed.has(value.series)) {
        for (const plot of value.plots) if (plot.visual?.source) channels.push({ name: plot.name, kind: plot.kind, points: plot.visual.source.points.map((point: any) => ({ time: point.time, value: point.value })) });
        continue;
      }
      if (depth >= 5 || ArrayBuffer.isView(value) || value instanceof Node) continue;
      const children = value instanceof Map || value instanceof Set ? [...value.values()] : Object.values(value);
      for (const child of children) if (child && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
    }
    return channels;
  });
}
function macdOracle(closes: number[]) {
  const ema = (values: number[], length: number) => { const alpha = 2 / (length + 1); let previous = values[0]; return values.map((value, index) => previous = index ? alpha * value + (1 - alpha) * previous : value); };
  const fast = ema(closes, 3), slow = ema(closes, 26), macd = fast.map((value, index) => value - slow[index]), signal = ema(macd, 9);
  return { MACD: macd, Signal: signal, Histogram: macd.map((value, index) => value - signal[index]) };
}
function verifyMacd(plots: Array<{ name: string; values: any[] }>, closes: number[]) {
  const oracle = macdOracle(closes), failures: any[] = [];
  for (const [name, values] of Object.entries(oracle)) {
    const actual = plots.find(plot => plot.name === name)?.values; expect(actual).toHaveLength(closes.length);
    // Seed differences have decayed before the last 20 candles. Inspect every
    // tail point against an independent EMA recurrence in one bounded assertion.
    for (let index = closes.length - 20; index < closes.length; index++) if (typeof actual![index] !== "number" || Math.abs(actual![index] - values[index]) >= 1e-8) failures.push({ name, index, actual: actual![index], expected: values[index] });
  }
  expect(failures).toEqual([]);
}
test.afterEach(async ({ page }, info) => {
  expect(seal()).toBe(initialSeal); expect(hashes()).toEqual(initialHashes);
  if (info.status === info.expectedStatus) return;
  const folder = path.resolve(".artifacts/pine-starters174", info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "failure.json"), JSON.stringify({ initialSeal, currentSeal: seal(), initialHashes, responses: await responses(page), body: await page.locator("body").innerText() }, null, 2));
});
test("six real editable Pine starters reset saved attribution and run, then customised MACD saves and renders", async ({ page }, info) => {
  const errors: string[] = [], harnessErrors: string[] = [], workers: any[] = [], runs: any[] = [];
  page.on("pageerror", error => {
    if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") harnessErrors.push(error.message); else errors.push(error.message);
  });
  await page.addInitScript(() => {
    if (window !== window.top) return; (window as any).__starters174 = [];
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__starters174.push(event.data.payload);
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => { const response = await route.fetch(), bytes = await response.body(); workers.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) }); await route.fulfill({ response, body: bytes }); });
  const state = await liveViewportSetup(page), dialog = await editor(page), sourceField = dialog.getByLabel("EdgeLab indicator source", { exact: true }), templates = dialog.getByLabel("New script template", { exact: true }), library = dialog.getByLabel("Script library", { exact: true });
  await expect(templates).toBeVisible();
  expect(PINE_INDICATOR_STARTERS.map(({ id, name }) => ({ id, name }))).toEqual(expected.map(({ id, name }) => ({ id, name })));
  const options = await templates.locator('optgroup[label="Pine indicators"] option').evaluateAll(nodes => nodes.map(node => ({ id: (node as HTMLOptionElement).value, name: node.textContent })));
  expect(options).toEqual(expected.map(({ id, name }) => ({ id, name })));
  // A genuinely imported and saved catalog script supplies attribution and a
  // selected saved identity before each new-starter action.
  const browser = dialog.locator("details").filter({ hasText: "Community Pine catalog" }); await browser.locator("summary").click();
  await selectPineCatalogScript(browser, attributed.id); await browser.getByRole("button", { name: "View source", exact: true }).click();
  await browser.getByRole("button", { name: "Import draft", exact: true }).click(); await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.length).toBe(1);
  const savedBefore = structuredClone(state.storage.get("custom-indicator-scripts.v1")), attributedId = savedBefore[0].id; expect(savedBefore[0].catalogOrigin.catalogId).toBe(attributed.id);
  const folder = path.resolve(".artifacts/pine-starters174", info.project.name); fs.mkdirSync(folder, { recursive: true });
  await templates.scrollIntoViewIfNeeded(); await templates.focus(); await page.screenshot({ path: path.join(folder, "starter-selector.png") });
  const selectorStyle = await templates.evaluate(node => { const style = getComputedStyle(node), box = node.getBoundingClientRect(); return { background: style.backgroundColor, color: style.color, colorScheme: style.colorScheme, width: box.width, height: box.height, x: box.x, right: box.right, viewport: innerWidth }; });
  for (const item of expected) {
    await library.selectOption(attributedId); await expect(dialog.getByRole("region", { name: "Catalog source attribution", exact: true })).toBeVisible();
    const starter = PINE_INDICATOR_STARTERS.find(starter => starter.id === item.id)!; await templates.selectOption(item.id);
    await expect(sourceField).toHaveValue(starter.source); await expect(sourceField).toBeFocused(); await expect(library).toHaveValue("");
    await expect(dialog.getByRole("region", { name: "Catalog source attribution", exact: true })).toHaveCount(0); await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
    await checkedRun(dialog); const run = await observed(page, starter.source); runs.push(run);
    expect(run).toMatchObject({ name: item.name, overlay: item.overlay, pineVersion: 6, language: "pine", declaration: "indicator", audit: { engine: "PineTS", bars: 600 } });
    expect(run.inputDefinitions.map((input: any) => [input.title, input.type])).toEqual(item.inputs);
    item.numbers.forEach((value, index) => { if (value !== null) expect(run.inputs[`in_${index}`]).toBe(value); });
    expect(run.plots.filter((plot: any) => item.plots.includes(plot.name)).map((plot: any) => plot.name).sort()).toEqual([...item.plots].sort());
    for (const name of item.plots) expect(run.plots.find((plot: any) => plot.name === name).values.some((value: any) => typeof value === "number" && Number.isFinite(value) || Array.isArray(value) && value.every(Number.isFinite))).toBe(true);
    expect(state.storage.get("custom-indicator-scripts.v1")).toEqual(savedBefore); expect(chartCopies(state.storage.get("live-chart-layout.v1"))).toEqual([]);
    await expect(page.getByRole("region", { name: `${item.name} native Pine pane`, exact: true })).toHaveCount(0);
    await sourceField.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(folder, `${item.id}-editor.png`) });
  }
  const macd = PINE_INDICATOR_STARTERS.find(starter => starter.id === "pine-macd")!;
  await templates.selectOption(macd.id); await checkedRun(dialog);
  const fast = dialog.getByRole("spinbutton", { name: "Fast length", exact: true }); await expect(fast).toHaveValue("12"); await fast.fill("3");
  await dialog.getByRole("button", { name: "Run", exact: true }).click(); await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
  const customised = await observed(page, macd.source, result => result.kind === "run" && !result.sessionId && result.inputs.in_1 === 3); verifyMacd(customised.plots, state.history.map(bar => bar.close));
  await expect(sourceField).toHaveValue(macd.source); await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.length).toBe(2);
  const saved = state.storage.get("custom-indicator-scripts.v1").find((script: any) => script.source === macd.source); expect(saved.inputs.in_1).toBe(3); expect(saved.catalogOrigin).toBeUndefined(); expect(saved.id).not.toBe(attributedId);
  expect(state.storage.get("custom-indicator-scripts.v1").find((script: any) => script.id === attributedId)).toEqual(savedBefore[0]);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click(); await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click(); const raw = [...state.history, state.emit(600, 67525)];
  const live = await observed(page, macd.source, result => result.sessionId && result.sequence > 0 && result.inputs.in_1 === 3); verifyMacd(live.plots, raw.map(bar => bar.close));
  const pane = page.getByRole("region", { name: "MACD native Pine pane", exact: true }); await expect(pane).toBeVisible();
  await expect.poll(async () => { const chart = await rendered(pane); return ["MACD", "Signal", "Histogram"].every(name => chart.find(plot => plot.name === name)?.points.at(-1)?.time === raw.at(-1)!.time); }).toBe(true);
  const chart = await rendered(pane); verifyMacd(chart.map(plot => ({ name: plot.name, values: plot.points.map((point: any) => point.value) })), raw.map(bar => bar.close));
  for (const name of ["MACD", "Signal", "Histogram"]) expect(chart.find(plot => plot.name === name).points.map((point: any) => point.time)).toEqual(raw.map(bar => bar.time));
  await expect.poll(() => chartCopies(state.storage.get("live-chart-layout.v1")).some(copy => copy.customScriptSource === macd.source && copy.settings?.customInputs?.in_1 === 3)).toBe(true);
  await pane.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(folder, "custom-macd-native.png") });
  const workerName = fs.readdirSync("frontend/dist/assets").find(file => /^pine-native-worker.*\.js$/.test(file))!, worker = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  expect(workers.length).toBeGreaterThan(0); expect(workers.every(item => item.sha256 === hash(worker) && item.bytes === worker.length)).toBe(true); expect(errors).toEqual([]);
  fs.writeFileSync(path.join(folder, "receipt.json"), JSON.stringify({ initialSeal, afterSeal: seal(), initialHashes, afterHashes: hashes(), workerName, workerSha256: hash(worker), workers, selectorStyle, options, savedBefore, saved, runs, customised, live, chart, copies: chartCopies(state.storage.get("live-chart-layout.v1")), errors, harnessErrors,
    qualification: "Genuine production editor/new-template native select and PineTS worker; static starter-source import is exact-text expectation only. Authentication/storage/provider transport fixtures, no engine/controller/result substitutions. Six defaults plus independent MACD EMA tail oracle and genuine native packedprimitive. Native select screenshots show the real editor/control, not a custom popup." }, null, 2));
});
