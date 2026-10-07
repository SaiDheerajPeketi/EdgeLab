import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { test as base, expect, type Page } from "@playwright/test";
import { productSetup, editor, checkedRun, observed } from "./pine-layering.product-support";

const artifacts = path.resolve(".artifacts/pine-bars53");
const original = fs.readFileSync("e2e/pine-visuals.bars.json");
expect(createHash("sha256").update(original).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars = JSON.parse(original.toString()).map((bar: any) => ({ ...bar, open: 90, high: 115, low: 85, close: 110 }));
type Harness = { origin: string; workerSha256: string; workerBytes: number; workerRequests: string[]; otherRequests: string[] };

const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const assets = path.resolve("frontend/dist/assets");
    const name = fs.readdirSync(assets).find((value) => /^pine-native-worker.*\.js$/.test(value));
    if (!name) throw new Error("A frozen production worker build is required.");
    const workerPath = "/assets/" + name;
    const worker = fs.readFileSync(path.join(assets, name));
    const bundle = await build({
      entryPoints: [path.resolve("e2e/pine-layering.fixture.ts")],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "layerFixture",
      plugins: [{ name: "authentic-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "authentic-worker" }));
        builder.onLoad({ filter: /.*/, namespace: "authentic-worker" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
      } }],
    });
    const workerRequests: string[] = [];
    const otherRequests: string[] = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native Pine OHLC bars</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}h1{font-size:20px}h2{font-size:14px}#main,#pane{width:100%}</style><h1>Actual native OHLC bars</h1><h2>Price chart</h2><div id="main"></div><h2>Separate Pine pane</h2><div id="pane"></div><script src="/fixture.js"></script>');
      } else if (pathname === "/fixture.js") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(bundle.outputFiles[0].contents);
      } else if (pathname === workerPath) {
        workerRequests.push(pathname);
        response.setHeader("Content-Type", "text/javascript");
        response.end(worker);
      } else if (pathname === "/favicon.ico") {
        response.statusCode = 204;
        response.end();
      } else {
        otherRequests.push(pathname);
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture server port.");
    try {
      await use({ origin: "http://127.0.0.1:" + address.port, workerSha256: createHash("sha256").update(worker).digest("hex"), workerBytes: worker.length, workerRequests, otherRequests });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => {
    serverHarness.workerRequests.length = 0;
    serverHarness.otherRequests.length = 0;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(serverHarness.origin);
    await use(serverHarness);
    expect(errors).toEqual([]);
    expect(serverHarness.otherRequests).toEqual([]);
    expect(serverHarness.workerRequests.length).toBeGreaterThan(0);
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  },
});

const program = (body: string, overlay = false, behind = false) =>
  `//@version=6\nindicator("OHLC bars",overlay=${overlay},behind_chart=${behind})\n${body}`;
const upward = 'plotbar(80,125,75,120,title="Bars",color=#ff0000)';
const background = [17, 24, 39];
const red = [255, 0, 0];
const blue = [0, 0, 255];
const gray = [71, 85, 105];

async function run(page: Page, source: string, extra: any = {}) {
  const result = await page.evaluate((input) => (window as any).layerFixture.run(input), { source, bars, ...extra });
  expect(result.completed, JSON.stringify(result)).toBe(true);
  expect(result.engine).toBe("0.11.0");
  expect(result.source).toBe(source);
  return result;
}

async function probe(page: Page, index: number, price: number, dx = 0, placement = "pane") {
  const result = await page.evaluate((input) => (window as any).layerFixture.probe(input.index, input.price, input.placement, false, input.dx), { index, price, dx, placement });
  // Read actual lower-pane bitmap coordinates, without resizing/compositing it.
  const layer = result.layers[0];
  if (!layer) throw new Error("Actual native pane bitmap missing.");
  return { ...result, rgb: layer.rgba.slice(0, 3) };
}

function rgb(actual: number[], expected: number[], label: string) {
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(actual[channel] - expected[channel]), label + " channel " + channel).toBeLessThanOrEqual(2);
  }
}

async function capture(page: Page, name: string, project: string, result: any, harness: Harness) {
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, name + "-" + project + ".png") });
  fs.writeFileSync(path.join(artifacts, name + "-" + project + ".json"), JSON.stringify({ workerSha256: harness.workerSha256, workerBytes: harness.workerBytes, workerRequests: harness.workerRequests, result }, null, 2));
}

async function shape(page: Page, index: number, open: number, close: number, color: number[], placement = "pane") {
  const points = {
    stem: await probe(page, index, 100, 0, placement),
    upperStem: await probe(page, index, 123, 0, placement),
    lowerStem: await probe(page, index, 78, 0, placement),
    openLeft: await probe(page, index, open, -2, placement),
    openRight: await probe(page, index, open, 2, placement),
    closeRight: await probe(page, index, close, 2, placement),
    closeLeft: await probe(page, index, close, -2, placement),
    bodyLeft: await probe(page, index, 100, -2, placement),
    bodyRight: await probe(page, index, 100, 2, placement),
  };
  for (const key of ["stem", "upperStem", "lowerStem", "openLeft", "closeRight"] as const) rgb(points[key].rgb, color, key);
  for (const key of ["openRight", "closeLeft", "bodyLeft", "bodyRight"] as const) rgb(points[key].rgb, background, key + " remains unfilled");
  return points;
}

test("native OHLC bars have full stems open-left close-right ticks and no candle body", async ({ page, harness }, info) => {
  const evidence: any[] = [];
  for (const inverted of [false, true]) {
    const result = await run(page, program(upward), { inverted });
    expect(result.plots[0].samples[0].point.value).toEqual([80, 125, 75, 120]);
    expect(result.drawn[0]).toMatchObject({ kind: "candles", overlay: false });
    evidence.push({ inverted, result, geometry: await shape(page, 130, 80, 120, red) });
  }
  await capture(page, "ohlc-geometry", info.project.name, evidence, harness);
});

test("dynamic up-down colors na display and show-last retain genuine native values", async ({ page, harness }, info) => {
  const evidence: any[] = [];
  const down = await run(page, program('plotbar(120,125,75,80,title="Down",color=#0000ff)'));
  evidence.push({ down, geometry: await shape(page, 130, 120, 80, blue) });
  const dynamic = await run(page, program('plotbar(80,125,75,120,title="Dynamic",color=bar_index%3==0?#ff0000:bar_index%3==1?#0000ff:na)'));
  rgb((await probe(page, 129, 100)).rgb, red, "dynamic red");
  rgb((await probe(page, 130, 100)).rgb, blue, "dynamic blue");
  rgb((await probe(page, 131, 100)).rgb, background, "na does not paint a stem");
  evidence.push(dynamic);
  await capture(page, "dynamic-colors", info.project.name, dynamic, harness);
  const last = await run(page, program('plotbar(80,125,75,120,title="Last",color=#ff0000,show_last=2)'), { from: 248, to: 258 });
  rgb((await probe(page, 253, 100)).rgb, background, "older bar excluded");
  rgb((await probe(page, 254, 100)).rgb, red, "penultimate bar shown");
  rgb((await probe(page, 255, 100)).rgb, red, "latest bar shown");
  evidence.push(last);
  for (const option of ['color=na', 'color=#ff0000,display=display.none']) {
    const hidden = await run(page, program('plotbar(80,125,75,120,title="Hidden",' + option + ')'));
    rgb((await probe(page, 130, 100)).rgb, background, "hidden stem");
    rgb((await probe(page, 130, 80, -2)).rgb, background, "hidden open tick");
    evidence.push(hidden);
  }
  await capture(page, "color-visibility", info.project.name, evidence, harness);
});

test("omitted duplicate and numeric plotbar titles retain distinct ordered native channels", async ({ page, harness }, info) => {
  const values = [[76, 84, 72, 80], [92, 102, 88, 98], [112, 125, 108, 120]];
  const colors = [red, blue, [0, 255, 0]];
  const priceProbes = [78, 95, 115];
  const evidence: any[] = [];
  for (const titles of [undefined, ["Same bars", "Same bars", "Same bars"], ["2", "1", "3"]]) {
    const body = values.map((value, index) =>
      `plotbar(${value.join(",")}${titles === undefined ? "" : `,title="${titles[index]}"`},color=${["#ff0000", "#0000ff", "#00ff00"][index]})`
    ).join("\n");
    const source = program(body);
    const response = await page.evaluate((input) => (window as any).layerFixture.execute(input), { source, bars });
    expect(response.completed, JSON.stringify(response)).toBe(true);
    expect(response.result.source).toBe(source);
    expect(response.result.plots).toHaveLength(3);
    expect(new Set(response.result.plots.map((plot: any) => plot.id)).size).toBe(3);
    for (let index = 0; index < 3; index++) {
      const plot = response.result.plots[index];
      expect(plot.points).toHaveLength(bars.length);
      expect(new Set(plot.points.map((point: any) => point.time)).size).toBe(bars.length);
      for (let slot = 0; slot < bars.length; slot++) {
        expect(plot.points[slot].time).toBe(bars[slot].time);
        expect(plot.points[slot].value).toEqual(values[index]);
      }
      expect(plot.name).toBe(titles === undefined ? `OHLC bars ${index + 1}` : titles[index]);
    }
    const result = await run(page, source);
    const pixels = [];
    for (let index = 0; index < 3; index++) {
      const pixel = await probe(page, 130, priceProbes[index]);
      rgb(pixel.rgb, colors[index], "independent channel " + index + " stem");
      pixels.push(pixel);
    }
    evidence.push({ titles, source, channelIds: response.result.plots.map((plot: any) => plot.id), result, pixels });
  }
  await capture(page, "multiple-channels", info.project.name, evidence, harness);
});

test("declaration planes and forced overlay change OHLC stem occlusion only", async ({ page, harness }, info) => {
  const evidence: any[] = [];
  for (const behind of [true, false]) {
    const result = await run(page, program(upward, true, behind));
    rgb((await probe(page, 130, 100, 0, "main")).rgb, behind ? gray : red, "stem candle occlusion");
    rgb((await probe(page, 130, 78, 0, "main")).rgb, red, "lower stem remains outside primary candle");
    evidence.push(result);
  }
  const forced = await run(page, program('plotbar(80,125,75,120,title="Forced",color=#ff0000,force_overlay=true)', false, true));
  expect(forced.drawn[0]).toMatchObject({ overlay: true, behindChart: false });
  rgb((await probe(page, 130, 100, 0, "main")).rgb, red, "forced pane bar is front");
  rgb((await probe(page, 130, 100)).rgb, background, "forced bar does not draw in separate pane");
  evidence.push(forced);
  await capture(page, "planes", info.project.name, evidence, harness);
});

test("packed twenty-thousand-bar OHLC data stays lazy through pan resize and dispose", async ({ page, harness }, info) => {
  const large = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[index % bars.length], time: bars[0].time + index * 60 }));
  const result = await run(page, program(upward), { bars: large, from: 19_960, to: 19_990 });
  expect(result.plots[0]).toMatchObject({ packed: true, bufferCount: 3, bufferBytes: 700_000 });
  expect(result.placements.pane.stats.decodedSamples).toBeLessThan(256);
  const tail = await shape(page, 19_975, 80, 120, red);
  const panned = await page.evaluate(() => (window as any).layerFixture.pan(10_000, 10_030));
  expect(panned.placements.pane.stats.decodedSamples).toBeLessThan(512);
  const middle = await shape(page, 10_015, 80, 120, red);
  const resized = await page.evaluate(() => (window as any).layerFixture.resize());
  expect(resized.placements.pane.stats.cacheEntries).toBeLessThanOrEqual(8192);
  rgb((await probe(page, 10_015, 100)).rgb, red, "stem after resize");
  await capture(page, "packed-active", info.project.name, { result, tail, panned, middle, resized }, harness);
  await page.evaluate(() => (window as any).layerFixture.dispose());
  rgb((await probe(page, 10_015, 100)).rgb, background, "dispose clears stem");
  await capture(page, "packed-lifecycle", info.project.name, { result, tail, panned, middle, resized }, harness);
});

async function productPixels(page: Page) {
  return page.locator(".chart-stage").first().evaluate((stage) => {
    const canvas = [...stage.querySelectorAll("canvas")].filter((item) => item.getBoundingClientRect().height > 80).sort((a, b) => b.width - a.width)[0];
    if (!canvas) throw new Error("Actual primary canvas missing.");
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0) red++;
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 255) blue++;
    }
    return { red, blue, width: canvas.width, height: canvas.height };
  });
}

test("saved native OHLC source reloads reruns inputs and restores chart after removal", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const context = await productSetup(page);
  const source = program('shade=input.color(#ff0000,"Shade")\nplotbar(open-12,high+8,low-8,close+12,title="User bars",color=shade)', true).replace("OHLC bars", "Saved OHLC bars");
  let dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await checkedRun(dialog);
  const initial = await observed(page, source, "#FF0000FF");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => context.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === source)).toBe(true);
  const saved = structuredClone(context.storage.get("custom-indicator-scripts.v1").find((script: any) => script.source === source));
  await page.reload();
  dialog = await editor(page);
  await dialog.getByLabel("Script library", { exact: true }).selectOption(saved.id);
  await expect(dialog.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(source);
  await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const row = page.locator(".native-study-chip").filter({ hasText: "Saved OHLC bars" }).first();
  await expect(row).toBeVisible();
  await expect.poll(async () => (await productPixels(page)).red).toBeGreaterThan(0);
  await row.getByRole("button", { name: "Inputs for Saved OHLC bars", exact: true }).click();
  await row.getByRole("textbox", { name: "Shade", exact: true }).fill("#0000ff");
  const edited = await observed(page, source, "#0000ff");
  await expect.poll(async () => (await productPixels(page)).blue).toBeGreaterThan(0);
  await row.getByRole("button", { name: "Close inputs for Saved OHLC bars", exact: true }).click();
  await row.getByRole("button", { name: "Remove Saved OHLC bars", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(async () => (await productPixels(page)).blue).toBe(0);
  expect(context.storage.get("custom-indicator-scripts.v1").find((script: any) => script.id === saved.id)).toEqual(saved);
  const assets = path.resolve("frontend/dist/assets");
  const workerName = fs.readdirSync(assets).find((value) => /^pine-native-worker.*\.js$/.test(value))!;
  const worker = fs.readFileSync(path.join(assets, workerName));
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  expect(context.workerReceipts.length).toBeGreaterThan(0);
  for (const receipt of context.workerReceipts) expect(receipt.sha256).toBe(workerSha256);
  expect(errors).toEqual([]);
  await capture(page, "saved-product", info.project.name, { source, initial, edited, saved, pixels: await productPixels(page), errors }, {
    origin: page.url(), workerSha256, workerBytes: worker.length, workerRequests: context.workerReceipts.map((item) => item.url), otherRequests: [],
  });
});
