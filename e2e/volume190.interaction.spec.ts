import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PINE_INDICATOR_STARTERS } from "../frontend/src/lib/pineStarters";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor } from "./pine-layering.product-support";
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String)
  .filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort()
  .map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const round = (value: number) => Math.round(value * 1e10) / 1e10;
function ema(data: (number | null)[], length: number) {
  const seed: number[] = []; let average: number | null = null;
  return data.map(value => {
    if (value === null) return null;
    if (average === null) { seed.push(value); if (seed.length < length) return null; average = seed.reduce((a, b) => a + b, 0) / length; }
    else average += (value - average) * 2 / (length + 1);
    return round(average);
  });
}
function expected(id: string, bars: Bar[], inputs: Record<string, any>) {
  const flow = bars.map(bar => round(bar.high === bar.low ? 0 : ((bar.close - bar.low) - (bar.high - bar.close)) / (bar.high - bar.low)) * bar.volume);
  if (id === "pine-cmf") return bars.map((_, i) => {
    const length = inputs.in_0 ?? 20; if (i < length - 1) return null;
    const volume = bars.slice(i - length + 1, i + 1).reduce((a, bar) => a + bar.volume, 0);
    return volume ? flow.slice(i - length + 1, i + 1).reduce((a, b) => a + b, 0) / volume : null;
  });
  if (id === "pine-chaikin-oscillator") {
    let sum = 0; const accumulated = flow.map(value => round(sum += value));
    const fast = ema(accumulated, inputs.in_0 ?? 3), slow = ema(accumulated, inputs.in_1 ?? 10);
    return fast.map((value, i) => value === null || slow[i] === null ? null : value - slow[i]!);
  }
  const source = inputs.in_0 ?? "close";
  return ema(bars.map((bar, i) => i ? round((bar as any)[source] - (bars[i - 1] as any)[source]) * bar.volume : null), inputs.in_1 ?? 13);
}
async function results(page: Page, name: string) {
  return page.evaluate(name => ((window as any).__volume190 ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.name !== name) return [];
    return [{ source: result.source, inputs: result.inputs, overlay: result.overlay, sessionId: payload.sessionId, sequence: payload.sequence,
      plots: result.plots.map((plot: any) => {
        if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
        const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
        return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? values[i] : null) };
      }) }];
  }), name);
}
function compare(result: any, id: string, bars: Bar[], name: string) {
  const values = result.plots.find((plot: any) => plot.name === name)?.values;
  const reference = expected(id, bars, result.inputs); expect(values).toHaveLength(reference.length);
  reference.forEach((value, i) => value === null ? expect(values[i]).toBeNull() :
    expect(typeof values[i] === "number" && Number.isFinite(values[i]) && Math.abs(values[i] - value) <= 1e-7).toBe(true));
}
test("native volume library and editor studies calculate custom inputs and real live rollback", async ({ page }, info) => {
  const before = seal(), errors: string[] = [], workers: any[] = [], sandboxErrors: string[] = [];
  page.on("pageerror", error => error.message.includes("Service worker is disabled because the context is sandboxed") ? sandboxErrors.push(error.message) : errors.push(error.message));
  await page.addInitScript(() => { if (window !== window.top) return; (window as any).__volume190 = [];
    addEventListener("message", event => {
      const owned = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')]
        .some(frame => frame.contentWindow === event.source && frame.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (owned && event.origin === "null" && event.data?.type === "result") (window as any).__volume190.push(event.data.payload);
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => {
    const response = await route.fetch(), bytes = await response.body();
    workers.push({ bytes: bytes.length, sha256: hash(bytes) }); await route.fulfill({ response, body: bytes });
  });
  const feed = await liveViewportSetup(page);
  let current = feed.emit(600, 67530, false, 15);
  const latest = async (name: string) => (await results(page, name)).filter((result: any) => result.sessionId).at(-1);
  const library = page.getByRole("button", { name: "Indicators", exact: true });
  if (!await library.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await library.click();
  await page.getByRole("searchbox", { name: "Search indicators by name, description, category, or synonym", exact: true }).fill("adl momentum");
  await page.getByRole("button", { name: "Add Chaikin Oscillator built-in indicator", exact: true }).click();
  await expect.poll(async () => (await latest("Chaikin Oscillator"))?.plots.find((plot: any) => plot.name === "Chaikin Oscillator")?.values.length).toBe(601);
  await page.getByRole("button", { name: "Close indicator library", exact: true }).click();
  const evidence: any[] = [];
  for (const [id, name, plotName] of [["pine-chaikin-oscillator", "Chaikin Oscillator", "Chaikin Oscillator"],
    ["pine-cmf", "Chaikin Money Flow", "CMF"], ["pine-elder-force", "Elder Force Index", "EFI"]]) {
    if (id !== "pine-chaikin-oscillator") {
      const dialog = await editor(page);
      await dialog.getByLabel("New script template", { exact: true }).selectOption(id);
      const original = PINE_INDICATOR_STARTERS.find(starter => starter.id === id)!.source;
      await expect(dialog.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(original);
      await dialog.getByRole("button", { name: "Check script", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Add to chart", exact: true })).toBeEnabled();
      await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
      await expect.poll(async () => (await latest(name))?.plots.find((plot: any) => plot.name === plotName)?.values.length).toBe(601);
      if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
    }
    await expect.poll(async () => (await latest(name))?.plots.find((plot: any) => plot.name === plotName)?.values.length).toBe(601);
    const pane = page.getByRole("region", { name: `${name} native Pine pane`, exact: true });
    await pane.scrollIntoViewIfNeeded(); await expect(pane.locator("canvas").first()).toBeVisible();
    const title = pane.getByRole("button", { name, exact: true });
    expect(await title.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await pane.locator(".tv-lightweight-charts").first().evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(160);
    const initial = await latest(name); compare(initial, id, [...feed.history, current], plotName);
    expect(initial.source).toBe(PINE_INDICATOR_STARTERS.find(starter => starter.id === id)!.source);
    expect(initial.overlay).toBe(false);
    if (id === "pine-chaikin-oscillator") {
      await pane.getByRole("button", { name, exact: true }).click();
      const controls = page.getByRole("group", { name: "Indicator settings", exact: true });
      await controls.getByLabel("Fast length", { exact: true }).fill("2"); await controls.getByLabel("Fast length", { exact: true }).press("Enter");
      await expect.poll(async () => (await latest(name))?.inputs.in_0).toBe(2);
      await page.getByRole("button", { name: "Close indicator settings", exact: true }).click();
      compare(await latest(name), id, [...feed.history, current], plotName);
    }
    evidence.push({ id, name, initial, changed: await latest(name) });
  }
  for (const close of [67533, 67501, 67530]) {
    const prior = await latest("Chaikin Oscillator"); current = feed.emit(600, close, false, 16);
    for (const item of evidence) {
      await expect.poll(async () => (await latest(item.name))?.sequence).toBeGreaterThan(item.changed.sequence);
      const result = await latest(item.name); expect(result.sessionId).toBe(item.changed.sessionId);
      compare(result, item.id, [...feed.history, current], item.id === "pine-cmf" ? "CMF" : item.id === "pine-elder-force" ? "EFI" : item.name);
      item.changed = result;
    }
    expect((await latest("Chaikin Oscillator")).sequence).toBeGreaterThan(prior.sequence);
  }
  expect(errors).toEqual([]); expect(workers.length).toBeGreaterThan(0); expect(seal()).toBe(before);
  const directory = path.resolve(".artifacts/pine-volume190", info.project.name); fs.mkdirSync(directory, { recursive: true });
  await page.getByRole("region", { name: "Chaikin Oscillator native Pine pane", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(directory, "native-volume-studies.png"), animations: "disabled" });
  fs.writeFileSync(path.join(directory, "receipt.json"), JSON.stringify({ beforeSeal: before, afterSeal: seal(), errors, sandboxErrors, workers,
    evidence, providerEvents: feed.events, sourcePreserved: true, qualification: "Actual production app, editor, saved scripts, minified worker and panes; only auth/storage/provider transport controlled." }, null, 2));
});
