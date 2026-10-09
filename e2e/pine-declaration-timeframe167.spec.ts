import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor, checkedRun } from "./pine-layering.product-support";

const name = "Declaration timeframe167";
const source = `//@version=6
indicator("${name}",overlay=false,timeframe="3",timeframe_gaps=false)
length=input.int(2,"Length",minval=1,maxval=5)
plot(ta.sma(close,length),"Calculation SMA",color=#00ffff)
plot(timeframe.multiplier,"Calculation minutes",display=display.none)`;
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const beforeSeal = seal();
const hashes = () => Object.fromEntries(["e2e/pine-declaration-timeframe167.config.ts", "e2e/pine-declaration-timeframe167.spec.ts"].map(file => [file, hash(fs.readFileSync(file))]));
const beforeHashes = hashes();

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const folder = path.resolve(".artifacts/pine-declaration-timeframe167", info.project.name); fs.mkdirSync(folder, { recursive: true });
  const lifecycle = await page.evaluate(() => ((window as any).__declaration167?.results ?? []).map((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    return { sessionId: payload.sessionId, sequence: payload.sequence, status: response?.status, inputs: response?.result?.inputs, error: response?.error };
  }));
  fs.writeFileSync(path.join(folder, "failure.json"), JSON.stringify({ lifecycle, results: await results(page), text: await page.locator("body").innerText() }, null, 2));
});

async function results(page: Page) {
  return page.evaluate(source => ((window as any).__declaration167.results ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    return [{ sessionId: payload.sessionId ?? null, sequence: payload.sequence ?? null, inputs: result.inputs, audit: result.audit, inputDefinitions: result.inputDefinitions,
      plots: result.plots.map((plot: any) => {
        if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
        const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
        return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? values[i] : kinds[i] === 3 ? true : kinds[i] === 2 ? false : null).filter((_, i) => kinds[i] !== 0) };
      }) }];
  }), source);
}
const tail = (result: any, name: string) => result.plots.find((plot: any) => plot.name === name).values.at(-1);
async function observed(page: Page, predicate: (result: any) => boolean) {
  await expect.poll(async () => (await results(page)).some(predicate)).toBe(true);
  return (await results(page)).findLast(predicate)!;
}

test("authored calculation timeframe controls rerun real live native studies and retire earlier outputs", async ({ page }, info) => {
  const errors: string[] = [], harnessErrors: string[] = [], workers: any[] = [];
  page.on("pageerror", error => {
    if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") harnessErrors.push(error.message);
    else errors.push(error.message);
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const state: any = { results: [], holdSession: null, held: null }; (window as any).__declaration167 = state;
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (!frame || event.origin !== "null" || event.data?.type !== "result") return;
      state.results.push(event.data.payload);
      if (state.holdSession && event.data.payload?.sessionId === state.holdSession && event.data.payload?.sequence > 0 && event.data.payload?.response?.result?.kind === "run") {
        state.held = event; event.stopImmediatePropagation();
      }
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => {
    const response = await route.fetch(), bytes = await response.body(); workers.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) });
    await route.fulfill({ response, body: bytes });
  });
  const state = await liveViewportSetup(page), currentTime = state.history.at(-1)!.time + 60;
  // Independent UTC grouping oracle, with incomplete leading/trailing groups
  // excluded. No worker aggregation, provider helpers or result-derived values.
  const closes = (minutes: number) => {
    const groups = new Map<number, typeof state.history>();
    for (const bar of state.history) { const start = Math.floor(bar.time / (minutes * 60)) * minutes * 60; groups.set(start, [...(groups.get(start) ?? []), bar]); }
    return [...groups].filter(([start, bars]) => bars.length === minutes && bars.every((bar, index) => bar.time === start + index * 60)).map(([, bars]) => bars.at(-1)!.close);
  };
  const historicalSma = (minutes: number) => { const values = closes(minutes); return (values.at(-1)! + values.at(-2)!) / 2; };
  const liveSma = (minutes: number, close: number) => (closes(minutes).at(-1)! + close) / 2;
  const dialog = await editor(page); await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source); await checkedRun(dialog);
  await expect(dialog.getByRole("textbox", { name: "Timeframe", exact: true })).toHaveValue("3");
  await expect(dialog.getByRole("checkbox", { name: "Wait for timeframe closes", exact: true })).not.toBeChecked();
  await expect(dialog.getByText("Calculation", { exact: true }).first()).toBeVisible();
  const historical = await observed(page, result => !result.sessionId);
  expect(historical.inputs).toEqual({ in_0: 2, in_1: "3", in_2: false }); expect(tail(historical, "Calculation SMA")).toBeCloseTo(historicalSma(3), 8);
  expect(historical.inputDefinitions.map((input: any) => [input.id, input.title, input.group ?? null])).toEqual([
    ["in_0", "Length", null], ["in_1", "Timeframe", "Calculation"], ["in_2", "Wait for timeframe closes", "Calculation"]]);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === source)).toBe(true);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click(); await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  state.emit(600, 67520);
  const first = await observed(page, result => result.sessionId && result.sequence > 0 && result.inputs.in_1 === "3");
  expect(tail(first, "Calculation SMA")).toBeCloseTo(liveSma(3, 67520), 8); expect(tail(first, "Calculation minutes")).toBe(3);
  const pane = page.getByRole("region", { name: `${name} native Pine pane`, exact: true }); await expect(pane).toBeVisible();
  await expect(pane.locator("p.sr-only")).toContainText(`Calculation SMA: ${tail(first, "Calculation SMA")}`);
  await pane.getByRole("button", { name, exact: true }).click();
  const settings = page.getByRole("group", { name: "Indicator settings", exact: true }), timeframe = settings.getByRole("textbox", { name: "Timeframe", exact: true }), gaps = settings.getByRole("checkbox", { name: "Wait for timeframe closes", exact: true });
  await expect(timeframe).toHaveValue("3"); await expect(settings.getByText("Calculation", { exact: true }).first()).toBeVisible();
  await page.evaluate(id => { (window as any).__declaration167.holdSession = id; }, first.sessionId);
  state.emit(600, 67521); await expect.poll(() => page.evaluate(() => Boolean((window as any).__declaration167.held))).toBe(true);
  await timeframe.fill("5");
  const five = await observed(page, result => result.sessionId && result.sessionId !== first.sessionId && result.sequence > 0 && result.inputs.in_1 === "5");
  expect(tail(five, "Calculation SMA")).toBeCloseTo(liveSma(5, 67521), 8); expect(tail(five, "Calculation minutes")).toBe(5);
  await expect(pane.locator("p.sr-only")).toContainText(`Calculation SMA: ${tail(five, "Calculation SMA")}`);
  await page.evaluate(() => { const state = (window as any).__declaration167, held = state.held; state.holdSession = null; state.held = null;
    dispatchEvent(new MessageEvent("message", { data: held.data, origin: held.origin, source: held.source, ports: held.ports })); });
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1);
  await expect(pane.locator("p.sr-only")).toContainText(`Calculation SMA: ${tail(five, "Calculation SMA")}`);
  const retiredCount = (await results(page)).filter(result => result.sessionId === first.sessionId).length;
  state.emit(600, 67522);
  const fiveNext = await observed(page, result => result.sessionId === five.sessionId && result.sequence > five.sequence);
  expect(tail(fiveNext, "Calculation SMA")).toBeCloseTo(liveSma(5, 67522), 8);
  expect((await results(page)).filter(result => result.sessionId === first.sessionId)).toHaveLength(retiredCount);
  await gaps.check();
  const waiting = await observed(page, result => result.sessionId && result.sessionId !== five.sessionId && result.sequence > 0 && result.inputs.in_1 === "5" && result.inputs.in_2 === true);
  expect(tail(waiting, "Calculation SMA")).toBeNull(); expect(tail(waiting, "Calculation minutes")).toBeNull();
  const lastConfirmed = waiting.plots.find((plot: any) => plot.name === "Calculation SMA").values.findLast((value: unknown) => typeof value === "number");
  expect(lastConfirmed).toBeCloseTo(historicalSma(5), 8);
  await expect(pane.locator("p.sr-only")).toContainText(`Calculation SMA: ${lastConfirmed}`);
  const knownBeforeResume = (await results(page)).map(result => result.sessionId).filter(Boolean);
  await gaps.uncheck();
  const resumed = await observed(page, result => result.sessionId && !knownBeforeResume.includes(result.sessionId) && result.sequence > 0 && result.inputs.in_1 === "5" && result.inputs.in_2 === false);
  expect(tail(resumed, "Calculation SMA")).toBeCloseTo(liveSma(5, 67522), 8);
  await timeframe.fill("");
  const chart = await observed(page, result => result.sessionId && result.sessionId !== resumed.sessionId && result.sequence > 0 && result.inputs.in_1 === "");
  expect(tail(chart, "Calculation SMA")).toBeCloseTo(liveSma(1, 67522), 8); expect(tail(chart, "Calculation minutes")).toBe(1);
  await expect(pane.locator("p.sr-only")).toContainText(`Calculation SMA: ${tail(chart, "Calculation SMA")}`);
  await expect(timeframe).toHaveValue(""); await expect(gaps).not.toBeChecked();
  expect(await page.locator(".chart-stage").count()).toBe(1); await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1);
  const workerName = fs.readdirSync("frontend/dist/assets").find(file => /^pine-native-worker.*\.js$/.test(file))!, worker = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  expect(workers.length).toBeGreaterThan(0); expect(workers.every(item => item.sha256 === hash(worker) && item.bytes === worker.length)).toBe(true);
  expect(errors).toEqual([]); expect(seal()).toBe(beforeSeal); expect(hashes()).toEqual(beforeHashes);
  const folder = path.resolve(".artifacts/pine-declaration-timeframe167", info.project.name); fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, "calculation-controls.png") });
  fs.writeFileSync(path.join(folder, "receipt.json"), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeHashes, afterHashes: hashes(), workerName, workerSha256: hash(worker), workers,
    currentTime, independentClosedGroups: { three: closes(3), five: closes(5) }, evidence: { historical, first, five, fiveNext, waiting, resumed, chart, retiredCount }, errors, harnessErrors,
    qualification: "Actual production live app/editor/native chart/control/controller and sealed worker. Auth/storage/provider transport fixtures only. Independent UTC SMA oracle and delayed delivery of an authentic retired-session response; engine/output remains unchanged." }, null, 2));
  await settings.getByTitle("Remove indicator", { exact: true }).click(); await expect(pane).toHaveCount(0);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
});
