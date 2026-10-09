import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String)
  .filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort()
  .map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const fixtures = () => Object.fromEntries(["e2e/builtins186.config.ts", "e2e/builtins186.interaction.spec.ts"]
  .map(file => [file, hash(fs.readFileSync(file))]));
async function setup(page: Page) {
  const errors: string[] = [], sandboxErrors: string[] = [], workers: any[] = [];
  page.on("pageerror", error => error.message.includes("Service worker is disabled because the context is sandboxed")
    ? sandboxErrors.push(error.message) : errors.push(error.message));
  await page.addInitScript(() => {
    if (window !== window.top) return; (window as any).__builtins186 = []; (window as any).__builtinsRaw186 = [];
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')]
        .find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (event.data?.type === "result") {
        const payload = event.data.payload, response = payload?.protocol === "pine-live-v1" ? payload.response : payload;
        (window as any).__builtinsRaw186.push({ ownedFrame: !!frame, origin: event.origin, status: response?.status,
          kind: response?.result?.kind, name: response?.result?.name, error: response?.error,
          sessionId: payload?.sessionId, sequence: payload?.sequence });
      }
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__builtins186.push(event.data.payload);
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => {
    const response = await route.fetch(), bytes = await response.body();
    workers.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) });
    await route.fulfill({ response, body: bytes });
  });
  const feed = await liveViewportSetup(page);
  // REST does not prove a received live event. Use the actual current M1 provider
  // receipt so native startup has 600 closed bars and one developing candle.
  const current = feed.emit(600, 67530, false, 15);
  return { feed, current, errors, sandboxErrors, workers };
}
async function responses(page: Page, name: string) {
  return page.evaluate(name => ((window as any).__builtins186 ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || result?.name !== name) return [];
    return [{ kind: result.kind, source: result.source, overlay: result.overlay, inputs: result.inputs, definitions: result.inputDefinitions,
      sessionId: payload.sessionId, sequence: payload.sequence,
      plots: (result.plots ?? []).map((plot: any) => {
        if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
        const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
        return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? values[i]
          : kinds[i] === 3 ? true : kinds[i] === 2 ? false : null).filter((_, i) => kinds[i] !== 0) };
      }) }];
  }), name);
}
async function library(page: Page, search: string) {
  const button = page.getByRole("button", { name: "Indicators", exact: true });
  if (!await button.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await button.click();
  await page.getByRole("searchbox", { name: "Search indicators by name, description, category, or synonym", exact: true }).fill(search);
}
async function add(page: Page, name: string) {
  await library(page, name);
  await page.getByRole("button", { name: `Add ${name} built-in indicator`, exact: true }).click();
  await expect.poll(async () => (await responses(page, name)).some(result => result.kind === "run" && result.sessionId
    && result.plots.some((plot: any) => plot.values.length === 601))).toBe(true);
  await expect(page.getByRole("dialog", { name: "EdgeLab indicator editor" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close indicator library", exact: true }).click();
}
async function capture(page: Page, info: TestInfo, filename: string) {
  const directory = path.resolve(".artifacts/pine-builtins186", info.project.name); fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, filename + ".png"), animations: "disabled" });
}
async function receipt(page: Page, info: TestInfo, before: string, evidence: any) {
  expect(seal()).toBe(before); const directory = path.resolve(".artifacts/pine-builtins186", info.project.name); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, info.title.includes("favorites") ? "favorites.json" : "catalog.json"),
    JSON.stringify({ scope: "Actual production app and opaque minified worker; only auth/storage/OHLC provider transport controlled",
      beforeSeal: before, afterSeal: seal(), fixtures: fixtures(), ...evidence }, null, 2));
}
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const directory = path.resolve(".artifacts/pine-builtins186", info.project.name); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, info.title.includes("favorites") ? "favorites-failure.json" : "catalog-failure.json"),
    JSON.stringify({ seal: seal(), fixtures: fixtures(), error: info.error?.message,
      rawLifecycle: await page.evaluate(() => (window as any).__builtinsRaw186 ?? []),
      runs: await Promise.all(["Stochastic", "Stochastic RSI", "Directional Movement Index", "Parabolic SAR", "Ichimoku Cloud"].map(async name => [name, await responses(page, name)])) }, null, 2));
});

test("direct built-in catalog additions create genuine oscillator panes and rerun changed inputs without opening the editor", async ({ page }, info) => {
  const before = seal(), context = await setup(page);
  for (const name of ["Stochastic", "Stochastic RSI", "Directional Movement Index"]) {
    await add(page, name);
    const pane = page.getByRole("region", { name: `${name} native Pine pane`, exact: true });
    await expect(pane).toBeVisible(); await expect(pane.locator("canvas").first()).toBeVisible();
    const result = (await responses(page, name)).filter(result => result.kind === "run" && result.sessionId).at(-1)!;
    expect(result.overlay).toBe(false); expect(result.source).toContain("Original EdgeLab starter");
    for (const label of name === "Directional Movement Index" ? ["+DI", "−DI", "ADX"] : ["%K", "%D"]) {
      const plot = result.plots.find((plot: any) => plot.name === label); expect(plot).toBeTruthy(); expect(plot.values).toHaveLength(601);
      expect(plot.values.at(-1)).toEqual(expect.any(Number));
    }
  }
  const pane = page.getByRole("region", { name: "Stochastic native Pine pane", exact: true });
  await pane.getByRole("button", { name: "Stochastic", exact: true }).click();
  const controls = page.getByRole("group", { name: "Indicator settings", exact: true });
  const previous = (await responses(page, "Stochastic")).filter(result => result.kind === "run" && result.sessionId).at(-1)!;
  await controls.getByLabel("Lookback", { exact: true }).fill("5");
  await controls.getByLabel("Lookback", { exact: true }).press("Enter");
  await expect.poll(async () => (await responses(page, "Stochastic")).some(result => result.kind === "run" && result.sessionId
    && result.inputs.in_0 === 5 && result.plots.find((plot: any) => plot.name === "%K")?.values.length === 601)).toBe(true);
  const changed = (await responses(page, "Stochastic")).filter(result => result.kind === "run" && result.sessionId && result.inputs.in_0 === 5).at(-1)!;
  expect(changed.source).toBe(previous.source); expect(changed.plots.find((plot: any) => plot.name === "%K").values.at(-1))
    .not.toBe(previous.plots.find((plot: any) => plot.name === "%K").values.at(-1));
  await capture(page, info, "native-panes-and-inputs");
  await page.getByRole("button", { name: "Close indicator settings", exact: true }).click();
  context.feed.emit(600, 67533, false, 16);
  await expect.poll(async () => (await responses(page, "Stochastic")).some(result => result.sessionId === changed.sessionId
    && result.sequence > changed.sequence && result.inputs.in_0 === 5 && result.plots.find((plot: any) => plot.name === "%K")?.values.length === 601)).toBe(true);
  const live = (await responses(page, "Stochastic")).filter(result => result.sessionId === changed.sessionId).at(-1)!;
  expect(live.plots.find((plot: any) => plot.name === "%K").values.at(-1)).not.toBe(changed.plots.find((plot: any) => plot.name === "%K").values.at(-1));
  expect(context.errors).toEqual([]); expect(context.workers.length).toBeGreaterThan(0);
  await receipt(page, info, before, { errors: context.errors, sandboxErrors: context.sandboxErrors, workers: context.workers,
    changed, live, providerEvents: context.feed.events });
});

test("favorites quick-add uses native SAR overlay and Ichimoku originals remain editable user copies", async ({ page }, info) => {
  const before = seal(), context = await setup(page);
  await library(page, "Parabolic SAR");
  await page.getByRole("button", { name: "Add Parabolic SAR to favorite indicators", exact: true }).click();
  await page.getByRole("button", { name: "Close indicator library", exact: true }).click();
  await page.getByRole("button", { name: "Studies", exact: true }).click();
  const favorites = page.getByLabel("Favorite indicators quick add", { exact: true });
  await favorites.getByRole("button", { name: "Add Parabolic SAR indicator", exact: true }).click();
  await expect.poll(async () => (await responses(page, "Parabolic SAR")).some(result => result.kind === "run" && result.sessionId
    && result.plots.find((plot: any) => plot.name === "SAR")?.values.length === 601)).toBe(true);
  await page.getByRole("button", { name: "Close studies controls", exact: true }).click();
  expect((await responses(page, "Parabolic SAR")).filter(result => result.kind === "run").at(-1)?.overlay).toBe(true);
  await expect(page.getByRole("region", { name: "Parabolic SAR native Pine pane", exact: true })).toHaveCount(0);
  const pill = page.locator(".chart-study-pill[data-indicator-id]").filter({ hasText: "Parabolic SAR" }).first();
  await expect(pill).toBeVisible(); await pill.click();
  const controls = page.getByRole("group", { name: "Indicator settings", exact: true });
  await controls.getByLabel("Start", { exact: true }).fill("0.04"); await controls.getByLabel("Start", { exact: true }).press("Enter");
  await expect.poll(async () => (await responses(page, "Parabolic SAR")).some(result => result.kind === "run" && result.sessionId
    && result.inputs.in_0 === .04 && result.plots.find((plot: any) => plot.name === "SAR")?.values.length === 601)).toBe(true);
  await capture(page, info, "favorite-sar-overlay");
  await page.getByRole("button", { name: "Close indicator settings", exact: true }).click();
  await add(page, "Ichimoku Cloud");
  await library(page, "Ichimoku Cloud");
  await page.getByRole("button", { name: "Open Ichimoku Cloud in the indicator editor", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "EdgeLab indicator editor", exact: true });
  const field = dialog.getByLabel("EdgeLab indicator source", { exact: true }), original = await field.inputValue();
  expect(original).toContain('indicator("Ichimoku Cloud", overlay=true)');
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Duplicate", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect.poll(() => context.feed.storage.get("custom-indicator-scripts.v1")?.some((item: any) => item.origin === "user" && item.source === original) ?? false).toBe(true);
  const edited = original + '\nprobe=input.float(2,"Editable multiplier")\nplot(close*probe,"Edited")';
  await field.fill(edited); await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByLabel("Editable multiplier", { exact: true })).toBeVisible();
  await dialog.getByLabel("Editable multiplier", { exact: true }).fill("3");
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(async () => (await responses(page, "Ichimoku Cloud")).some(result => result.source === edited && result.plots.some((plot: any) => plot.name === "Edited"))).toBe(true);
  const result = (await responses(page, "Ichimoku Cloud")).findLast(result => result.source === edited && result.kind === "run")!;
  expect(result.plots.find((plot: any) => plot.name === "Edited").values.at(-1)).toBeCloseTo(context.current.close * 3, 7);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => context.feed.storage.get("custom-indicator-scripts.v1")?.some((item: any) => item.origin === "user" && item.source === edited) ?? false).toBe(true);
  await capture(page, info, "editable-ichimoku-copy");
  expect(context.errors).toEqual([]); expect(context.workers.length).toBeGreaterThan(0);
  await receipt(page, info, before, { errors: context.errors, sandboxErrors: context.sandboxErrors, workers: context.workers,
    sar: (await responses(page, "Parabolic SAR")).filter(result => result.kind === "run").at(-1), original, edited, result,
    savedCopies: context.feed.storage.get("custom-indicator-scripts.v1") });
});
