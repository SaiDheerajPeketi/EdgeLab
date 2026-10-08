import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
declare global {
  interface Window {
    pineVisualFixture: any;
  }
}
const root = path.resolve(import.meta.dirname, ".."), bytes = fs.readFileSync(path.join(root, "e2e/pine-visuals.bars.json")), bars = JSON.parse(bytes.toString());
const hashes: Record<string, string> = { supertrend: "f693c60a20960bbd156455744838dc97892f2a5662810770c7677a66e9b5705d", chandelier_exit: "d505921fb4b9b7933b45a443cd3c13c255b30fa6c6216e7061844d3fb62eceda", halftrend: "efa1915b4d0812d8126bd27c7667f9408e90aeed94988058b1b1edeaa23f4a3c" };
const sourceFor = (name: string) => fs.readFileSync(path.join(root, "frontend/public/catalog/pine/everget/0b164e1e4f2fb7b06524c6d0a26e6132228c9448/trailing_stops", name + ".pine"), "utf8");
const program = (body: string, overlay = true, behindChart = true) => "//@version=6\nindicator(\"Canvas oracle\",overlay=" + overlay + (behindChart ? "" : ",behind_chart=false") + ")\n" + body;
type Harness = {
  origin: string;
  workerRequests: string[];
  otherRequests: string[];
};
const test = base.extend<{
  harness: Harness;
}, {
  serverHarness: Harness;
}>({
  serverHarness: [async ({}, use) => {
      expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
      const assets = path.join(root, "frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
      if (!workerName)
        throw new Error("Root must freeze/build production before this suite.");
      const workerPath = "/assets/" + workerName;
      const bundled = await build({ entryPoints: [path.join(root, "e2e/pine-visuals.fixture.ts")], bundle: true, write: false, platform: "browser", format: "iife", globalName: "pineVisualFixture",
        plugins: [{ name: "frozen-native-worker", setup(builder) {
              builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "production-worker", namespace: "pine-visual-fixture" }));
              builder.onLoad({ filter: /.*/, namespace: "pine-visual-fixture" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
            } }] });
      const worker = fs.readFileSync(path.join(assets, workerName)), workerRequests: string[] = [], otherRequests: string[] = [];
      const server = http.createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        response.setHeader("Cache-Control", "no-store");
        if (pathname === "/") {
          response.setHeader("Content-Type", "text/html");
          response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pine visual proof</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}h1{font-size:20px;margin:0 0 8px}p{color:#94a3b8;margin:0 0 18px}.chart{width:100%;margin-bottom:20px}</style><h1>Original Pine output · actual chart canvas</h1><p id="status" role="status">Awaiting genuine production engine</p><div id="main" class="chart"></div><div id="pane" class="chart" hidden></div><script src="/fixture.js"></script>');
        }
        else if (pathname === "/fixture.js") {
          response.setHeader("Content-Type", "text/javascript");
          response.end(bundled.outputFiles[0].contents);
        }
        else if (pathname === workerPath) {
          workerRequests.push(pathname);
          response.setHeader("Content-Type", "text/javascript");
          response.end(worker);
        }
        else if (pathname === "/favicon.ico") {
          response.statusCode = 204;
          response.end();
        }
        else {
          otherRequests.push(pathname);
          response.statusCode = 404;
          response.end();
        }
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Fixture server not bound");
      try {
        await use({ origin: "http://127.0.0.1:" + address.port, workerRequests, otherRequests });
      }
      finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => { serverHarness.workerRequests.length = 0; serverHarness.otherRequests.length = 0; await page.goto(serverHarness.origin); await use(serverHarness); }
});
async function run(page: any, source: string, snapshot = bars, options: any = {}) { const result = await page.evaluate(async (input: any) => window.pineVisualFixture.run(input.source, input.snapshot, input.options), { source, snapshot, options }); expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0); return result; }
async function probe(page: any, index: number, price: number, options: any = {}) { return page.evaluate((input: any) => window.pineVisualFixture.probe(input.time, input.price, input.options), { time: bars[index].time, price, options }); }
async function capture(page: any, name: string, project: string) { const directory = path.join(root, ".artifacts/pine-levels36"); fs.mkdirSync(directory, { recursive: true }); await page.screenshot({ path: path.join(directory, project + "-" + name + ".png"), fullPage: true }); }
// Independent raw PineTS oracle samples, pinned by the original source/fixture hashes above.
const ribbons: Record<string, {
  index: number;
  price: number;
  color: number[];
}[]> = { "supertrend": [{ "index": 46, "price": 98.9943944402828, "color": [76, 175, 80] }], "chandelier_exit": [{ "index": 47, "price": 99.97218415025772, "color": [76, 175, 80] }], "halftrend": [{ "index": 137, "price": 101.621238628125, "color": [242, 54, 69] }, { "index": 137, "price": 99.268212036275, "color": [41, 98, 255] }] };
const signals: Record<string, {
  buy: number;
  buyPrice: number;
  sell: number;
  sellPrice: number;
}> = {
  supertrend: { buy: 45, buyPrice: 94.8322617003, sell: 37, sellPrice: 103.7711127366 },
  chandelier_exit: { buy: 46, buyPrice: 95.6451460368, sell: 21, sellPrice: 102.710693606 },
  halftrend: { buy: 136, buyPrice: 97.3547500198, sell: 123, sellPrice: 109.2333870339 }
};
for (const name of Object.keys(hashes))
  test("genuine " + name + " paints absolute signals, white labels and ribbons on initial tail and pan", async ({ page, harness }, info) => {
    const source = sourceFor(name);
    expect(createHash("sha256").update(source).digest("hex")).toBe(hashes[name]);
    const output = await run(page, source);
    expect(output.outputs).toBe(9);
    expect(output.placements[0].series).toBe(1);
    expect(output.placements[0].finiteHostCoordinate).toBe(true);
    expect(output.adapterWarnings.filter((warning: string) => /not drawn|omitt|not rendered/i.test(warning))).toEqual([]);
    expect(harness.workerRequests).toHaveLength(1);
    expect(harness.otherRequests).toEqual([]);
    await capture(page, name + "-tail", info.project.name);
    const signal = signals[name];
    await page.evaluate(input => window.pineVisualFixture.pan(input.from, input.to), { from: signal.buy - 10, to: signal.buy + 10 });
    const marker = await probe(page, signal.buy, signal.buyPrice, { radius: 3 });
    expect(Number.isFinite(marker.x + marker.y)).toBe(true);
    expect(marker.changed).toBeGreaterThan(0);
    const label = await probe(page, signal.buy, signal.buyPrice, { dy: 11, radius: 14 });
    expect(label.white).toBeGreaterThan(0);
    if (name === "halftrend")
      expect(marker.blue).toBeGreaterThan(0);
    else
      expect(marker.green).toBeGreaterThan(0);
    for (const ribbon of ribbons[name]) {
      const sample = await page.evaluate(input => window.pineVisualFixture.intervalProbe(input.left, input.right, input.price), { left: bars[ribbon.index - 1].time, right: bars[ribbon.index].time, price: ribbon.price });
      const expected = ribbon.color.map((channel, index) => Math.round(channel * 38 / 255 + [17, 24, 39][index] * (1 - 38 / 255)));
      expect(sample.changed).toBeGreaterThan(0);
      for (let channel = 0; channel < 3; channel++)
        expect(Math.abs(sample.pixel[channel] - expected[channel])).toBeLessThanOrEqual(3);
    }
    await capture(page, name + "-buy", info.project.name);
    await page.evaluate(input => window.pineVisualFixture.pan(input.from, input.to), { from: signal.sell - 8, to: signal.sell + 8 });
    const sell = await probe(page, signal.sell, signal.sellPrice, { dy: -11, radius: 14 });
    expect(sell.white).toBeGreaterThan(0);
    const resized = await page.evaluate(() => window.pineVisualFixture.resize());
    expect(resized.placements[0].finiteHostCoordinate).toBe(true);
    await capture(page, name + "-sell", info.project.name);
  });
test("isolated fill paints hidden boundaries while null shades and gap endpoints remain unpainted", async ({ page, harness }, info) => {
  const source = program('a=plot(bar_index % 6 == 4 ? na : 110,"Hidden upper",display=display.none)\nb=plot(90,"Hidden lower",display=display.none)\nplot(100,"Shown",color=color.blue)\nfill(a,b,color=bar_index % 6 < 3 ? color.red : na,fillgaps=false)');
  const output = await run(page, source, bars, { from: 120, to: 137, bounds: [80, 120] });
  expect(output.placements[0].range.priceRange).toEqual({ minValue: 100, maxValue: 100 });
  const painted = await probe(page, 121, 96, { dx: -3, radius: 1 });
  expect(painted.red).toBeGreaterThan(0);
  const blank = await probe(page, 124, 96, { dx: -3, radius: 1 });
  expect(blank.red).toBe(0);
  expect(harness.workerRequests).toHaveLength(1);
  await capture(page, "dynamic-hidden-fill", info.project.name);
});
test("actual canvas paints true zero tiny and huge triangles and white labels on separate pane", async ({ page, harness }, info) => {
  const source = program('plotshape(bar_index == 126 ? 0 : na,"Zero triangle",style=shape.triangleup,location=location.absolute,color=color.red,size=size.tiny)\nplotshape(bar_index == 130 ? 0 : na,"Huge",style=shape.triangledown,location=location.absolute,color=color.blue,size=size.huge)\nplotshape(bar_index == 134 ? 0 : na,"Zero label",style=shape.labelup,location=location.absolute,color=color.red,text="ZERO",textcolor=color.white,size=size.tiny)', false);
  const output = await run(page, source, bars, { from: 120, to: 140, bounds: [-10, 120] });
  expect(output.placements).toHaveLength(2);
  expect(output.placements[1].finiteHostCoordinate).toBe(true);
  expect(output.placements[1].series).toBe(1);
  const triangle = await probe(page, 126, 0, { placement: 1, dy: 3, radius: 2 });
  expect(triangle.red).toBeGreaterThan(0);
  const huge = await probe(page, 130, 0, { placement: 1, dy: -10, radius: 4 });
  expect(huge.blue).toBeGreaterThan(0);
  const label = await probe(page, 134, 0, { placement: 1, dy: 11, radius: 15 });
  expect(label.white).toBeGreaterThan(0);
  await capture(page, "absolute-zero-pane", info.project.name);
});
for (const overlay of [true, false])
  test("packed 20k dots decode lazily through pan resize and dispose in " + (overlay ? "overlay" : "pane"), async ({ page, harness }, info) => {
    const snapshot = Array.from({ length: 20000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
    const source = program('plot(bar_index % 2 == 0 ? 100 : na,"Disconnected",style=plot.style_linebr,color=color.red)\nplot(bar_index % 2 == 0 ? 100 : na,"Dots",style=plot.style_circles,color=color.blue)', overlay);
    const output = await run(page, source, snapshot, { from: 19970, to: 19994 }), placement = overlay ? 0 : 1;
    expect(output.packed).toEqual([true, true]);
    expect(output.placements[placement].series).toBe(1);
    expect(output.placements[placement].finiteHostCoordinate).toBe(true);
    expect(output.placements[placement].stats.cacheEntries).toBeLessThan(100);
    const first = await page.evaluate(input => window.pineVisualFixture.probe(input.time, 100, { placement: input.placement, radius: 3 }), { time: snapshot[19980].time, placement });
    expect(first.blue).toBeGreaterThan(0);
    const panned = await page.evaluate(() => window.pineVisualFixture.pan(10000, 10024));
    expect(panned.placements[placement].finiteHostCoordinate).toBe(true);
    expect(panned.placements[placement].stats.cacheEntries).toBeLessThan(100);
    const middle = await page.evaluate(input => window.pineVisualFixture.probe(input.time, 100, { placement: input.placement, radius: 3 }), { time: snapshot[10010].time, placement });
    expect(middle.blue).toBeGreaterThan(0);
    const resized = await page.evaluate(() => window.pineVisualFixture.resize());
    expect(resized.placements[placement].finiteHostCoordinate).toBe(true);
    await capture(page, "packed-" + (overlay ? "overlay" : "pane"), info.project.name);
    const cleaned = await page.evaluate(() => window.pineVisualFixture.dispose());
    expect(cleaned[placement].stats.cacheEntries).toBe(0);
    const removed = await page.evaluate(input => window.pineVisualFixture.probe(input.time, 100, { placement: input.placement, radius: 3 }), { time: snapshot[10010].time, placement });
    expect(removed.blue).toBe(0);
  });
test("hidden fill references preserve primary price scale while standalone pane still paints", async ({ page, harness }, info) => {
  const body = 'a=plot(1000000000,"Hidden upper",display=display.none)\nb=plot(-1000000000,"Hidden lower",display=display.none)\nfill(a,b,color=color.red)';
  const overlay = await run(page, program(body), bars, { from: 120, to: 140 });
  expect(overlay.placements[0].range).toBeNull();
  expect(overlay.placements[0].primaryCoordinate).toBeCloseTo(overlay.placements[0].beforeCoordinate, 8);
  expect(overlay.placements[0].finiteHostCoordinate).toBe(true);
  // Sample below the primary candle body; fills deliberately sit behind candles.
  await capture(page, "extreme-fill-overlay", info.project.name);
  const painted = await probe(page, 130, 85, { radius: 2 });
  expect(painted.red).toBeGreaterThan(0);
  const pane = await run(page, program('a=plot(110,"Hidden upper",display=display.none)\nb=plot(90,"Hidden lower",display=display.none)\nfill(a,b,color=color.red)', false), bars, { from: 120, to: 140 });
  expect(pane.placements[1].range.priceRange).toEqual({ minValue: 90, maxValue: 110 });
  const ribbon = await probe(page, 130, 100, { placement: 1, radius: 2 });
  expect(ribbon.red).toBeGreaterThan(0);
  expect(harness.workerRequests).toHaveLength(2);
  await capture(page, "fill-only-pane", info.project.name);
});
// Expected colors are independent straight-RGBA interpolation followed by
// source-over compositing, matching the documented CanvasGradient behavior.
const gradientProgram = (call: string, upper = "110", lower = "90", hline = false, overlay = true) => program("a=" + (hline ? "hline" : "plot") + "(" + upper + ',"Mask A",display=display.none)\nb=' + (hline ? "hline" : "plot") + "(" + lower + ',"Mask B",display=display.none)\n' + call, overlay);
const background = [17, 24, 39];
function expectedGradient(price: number, top: number, bottom: number, topColor: number[], bottomColor: number[]) {
  const fraction = Math.max(0, Math.min(1, (price - top) / (bottom - top)));
  const rgba = topColor.map((value, index) => value + (bottomColor[index] - value) * fraction);
  return rgba.slice(0, 3).map((value, index) => Math.round(value * rgba[3] + background[index] * (1 - rgba[3])));
}
async function gradientProbe(page: any, snapshot: any[], index: number, price: number, options: any = {}) {
  return page.evaluate((input: any) => window.pineVisualFixture.intervalProbe(input.left, input.right, input.price, input.options), { left: snapshot[index - 1].time, right: snapshot[index].time, price, options });
}
function expectPixel(sample: any, expected: number[]) {
  expect(Number.isFinite(sample.x + sample.y)).toBe(true);
  expect(sample.pixel).toHaveLength(3);
  expected.forEach((value, channel) => expect(Math.abs(sample.pixel[channel] - value), "RGB channel " + channel + ": " + sample.pixel + " versus " + expected).toBeLessThanOrEqual(3));
}
test("native vertical gradient uses independent anchors inside narrow plot and hline masks", async ({ page, harness }, info) => {
  for (const hline of [false, true]) {
    const source = gradientProgram("fill(a,b,120,80,#ff0000,#0000ff)", "110", "90", hline);
    const output = await run(page, source, bars, { from: 120, to: 140 });
    expect(output.placements[0].range).toBeNull();
    expect(output.placements[0].primaryCoordinate).toBeCloseTo(output.placements[0].beforeCoordinate, 8);
    for (const price of [108, 100, 92]) {
      const sample = await gradientProbe(page, bars, 130, price);
      expectPixel(sample, expectedGradient(sample.samplePrice, 120, 80, [255, 0, 0, 1], [0, 0, 255, 1]));
    }
    expectPixel(await gradientProbe(page, bars, 130, 115), background);
    expectPixel(await gradientProbe(page, bars, 130, 85), background);
    await capture(page, hline ? "gradient-hline-mask" : "gradient-plot-mask", info.project.name);
  }
  expect(harness.workerRequests).toHaveLength(2);
});
test("gradient extends endpoint colors beyond anchor bounds only within a wider mask", async ({ page, harness }, info) => {
  await run(page, gradientProgram("fill(a,b,110,90,#ff0000,#0000ff)", "130", "70"), bars, { from: 120, to: 140, bounds: [60, 140] });
  for (const price of [120, 100, 80]) {
    const sample = await gradientProbe(page, bars, 130, price);
    expectPixel(sample, expectedGradient(sample.samplePrice, 110, 90, [255, 0, 0, 1], [0, 0, 255, 1]));
  }
  await capture(page, "gradient-wide-mask", info.project.name);
});
test("dynamic gradient bounds and transparent endpoint RGB remain series values on actual canvas", async ({ page, harness }, info) => {
  const source = gradientProgram('t=120+bar_index%2*20\nd=80-bar_index%2*20\nc=bar_index%4==0?na:bar_index%4==1?#ff000000:bar_index%4==2?#ff000080:#00ff00\nfill(a,b,t,d,c,#0000ff)');
  await run(page, source, bars, { from: 120, to: 140 });
  for (const index of [128, 129, 130, 131]) {
    const topColor = index % 4 === 0 ? [0, 0, 0, 0] : index % 4 === 1 ? [255, 0, 0, 0] : index % 4 === 2 ? [255, 0, 0, 128 / 255] : [0, 255, 0, 1];
    for (const price of [106, 100, 94]) {
      const sample = await gradientProbe(page, bars, index, price);
      expectPixel(sample, expectedGradient(sample.samplePrice, 120 + index % 2 * 20, 80 - index % 2 * 20, topColor, [0, 0, 255, 1]));
    }
  }
  await capture(page, "gradient-transparent-series", info.project.name);
});
test("gradient equal and missing anchors leave gaps while reversed anchors reverse the ramp", async ({ page, harness }, info) => {
  const source = gradientProgram('t=bar_index%4==0?120:bar_index%4==1?80:bar_index%4==2?100:na\nd=bar_index%4==0?80:bar_index%4==1?120:100\nfill(a,b,t,d,#ff0000,#0000ff)');
  const output = await run(page, source, bars, { from: 120, to: 140 });
  expect(output.warnings.some((warning: string) => /equal|zero.?span|degenerate/i.test(warning))).toBe(true);
  for (const index of [128, 129])
    for (const price of [106, 94]) {
      const sample = await gradientProbe(page, bars, index, price);
      expectPixel(sample, expectedGradient(sample.samplePrice, index % 4 === 0 ? 120 : 80, index % 4 === 0 ? 80 : 120, [255, 0, 0, 1], [0, 0, 255, 1]));
    }
  for (const index of [130, 131])
    expectPixel(await gradientProbe(page, bars, index, 100), background);
  await capture(page, "gradient-reversed-gaps", info.project.name);
});
test("clipped extreme gradient anchors preserve original RGBA ramp and hidden mask cannot expand primary scale", async ({ page, harness }, info) => {
  for (const extremeMask of [false, true]) {
    const top = extremeMask ? 120 : 1e9, bottom = extremeMask ? 80 : -1e9;
    const source = gradientProgram("fill(a,b," + top + "," + bottom + ",#ff000080,#0000ff)", extremeMask ? "1000000000" : "110", extremeMask ? "-1000000000" : "90");
    const output = await run(page, source, bars, { from: 120, to: 140 });
    expect(output.placements[0].range).toBeNull();
    expect(output.placements[0].primaryCoordinate).toBeCloseTo(output.placements[0].beforeCoordinate, 8);
    for (const price of [106, 100, 94]) {
      const sample = await gradientProbe(page, bars, 130, price);
      expectPixel(sample, expectedGradient(sample.samplePrice, top, bottom, [255, 0, 0, 128 / 255], [0, 0, 255, 1]));
    }
    await capture(page, extremeMask ? "gradient-extreme-mask" : "gradient-extreme-anchors", info.project.name);
  }
});
test("genuine gradient optional flags hide output and preserve fillgaps behavior", async ({ page, harness }, info) => {
  const hidden = await run(page, gradientProgram('fill(a,b,120,80,#ff0000,#0000ff,title="Hidden gradient",display=display.none,fillgaps=false,editable=false)'), bars, { from: 120, to: 140 });
  expect(hidden.drawn).toEqual([]);
  expect(hidden.plots.find((plot: any) => plot.options.gradient)).toMatchObject({ name: "Hidden gradient", options: { display: "none", fillgaps: false, editable: false } });
  expectPixel(await gradientProbe(page, bars, 130, 100), background);
  for (const gaps of [false, true]) {
    const source = gradientProgram("fill(a,b,120,80,#ff0000,#0000ff,fillgaps=" + gaps + ")", "bar_index==123?na:110");
    await run(page, source, bars, { from: 120, to: 140 });
    const sample = await gradientProbe(page, bars, 124, 100);
    expectPixel(sample, gaps ? expectedGradient(sample.samplePrice, 120, 80, [255, 0, 0, 1], [0, 0, 255, 1]) : background);
    await capture(page, gaps ? "gradient-fillgaps-true" : "gradient-fillgaps-false", info.project.name);
  }
});
test("crossing gradient mask clips lobes without painting the zero-width intersection", async ({ page, harness }, info) => {
  await run(page, gradientProgram("fill(a,b,120,80,#ff0000,#0000ff)", "bar_index%2==0?110:90", "bar_index%2==0?90:110"), bars, { from: 120, to: 140 });
  const inside = await gradientProbe(page, bars, 130, 100, { fraction: .25 });
  expectPixel(inside, expectedGradient(inside.samplePrice, 120, 80, [255, 0, 0, 1], [0, 0, 255, 1]));
  expectPixel(await gradientProbe(page, bars, 130, 106), background);
  await capture(page, "gradient-crossing-mask", info.project.name);
});
for (const continuous of [false, true]) for (const overlay of [true, false])
  test("packed 20k " + (continuous ? "continuous" : "periodic") + " actual gradient survives pan resize and disposal in " + (overlay ? "overlay" : "pane"), async ({ page, harness }, info) => {
    const snapshot = Array.from({ length: 20000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
    const top = continuous ? "120+bar_index*.01" : "120+bar_index%2*20", bottom = continuous ? "80-bar_index*.01" : "80-bar_index%2*20";
    const anchors = (index: number) => continuous ? [120 + index * .01, 80 - index * .01] : [120 + index % 2 * 20, 80 - index % 2 * 20];
    const source = gradientProgram("fill(a,b," + top + "," + bottom + ",bar_index%2==0?#ff0000:#00ff00,#0000ff)", "110", "90", false, overlay);
    const placement = overlay ? 0 : 1, output = await run(page, source, snapshot, { from: 19970, to: 19994 });
    expect(output.packed).toEqual([true, true, true]);
    expect(output.placements[placement].series).toBe(1);
    expect(output.placements[placement].stats.cacheEntries).toBeLessThan(100);
    const initial = await gradientProbe(page, snapshot, 19980, 100, { placement });
    expectPixel(initial, expectedGradient(initial.samplePrice, anchors(19980)[0], anchors(19980)[1], [255, 0, 0, 1], [0, 0, 255, 1]));
    await page.evaluate(() => window.pineVisualFixture.pan(10000, 10024));
    const panned = await gradientProbe(page, snapshot, 10011, 100, { placement });
    expectPixel(panned, expectedGradient(panned.samplePrice, anchors(10011)[0], anchors(10011)[1], [0, 255, 0, 1], [0, 0, 255, 1]));
    const resized = await page.evaluate(() => window.pineVisualFixture.resize());
    expect(resized.placements[placement].stats.cacheEntries).toBeLessThan(100);
    const changedSize = await gradientProbe(page, snapshot, 10010, 100, { placement });
    expectPixel(changedSize, expectedGradient(changedSize.samplePrice, anchors(10010)[0], anchors(10010)[1], [255, 0, 0, 1], [0, 0, 255, 1]));
    await capture(page, "gradient-packed-" + (continuous ? "continuous-" : "periodic-") + (overlay ? "overlay" : "pane"), info.project.name);
    const disposed = await page.evaluate(() => window.pineVisualFixture.dispose());
    expect(disposed[placement].stats.cacheEntries).toBe(0);
    expectPixel(await gradientProbe(page, snapshot, 10010, 100, { placement }), background);
  });

for (const overlay of [true, false]) test("fixed native levels span the pane with distinct styles through pan resize and disposal in " + (overlay ? "overlay" : "pane"), async ({ page, harness }, info) => {
  const source = program('hline(90,"Dotted",#00ff00,hline.style_dotted,2)\nhline(100,"Dashed",#0000ff,hline.style_dashed,2)\nhline(110,"Solid",#ff0000,hline.style_solid,2)', overlay);
  const placement = overlay ? 0 : 1;
  const output = await run(page, source, bars, { from: 250, to: 290, bounds: [80, 120] });
  expect(output.drawn).toEqual(["Dotted", "Dashed", "Solid"]);
  expect(output.adapterWarnings.filter((warning: string) => /not rendered|not drawn|omitt/i.test(warning))).toEqual([]);
  expect(output.placements[placement].range.priceRange).toEqual({ minValue: 90, maxValue: 110 });
  async function rows() {
    for (const [price, channel, solid] of [[90, "green", false], [100, "blue", false], [110, "red", true]] as const) {
      const row = await page.evaluate((input) => window.pineVisualFixture.levelProbe(input.price, { placement: input.placement, channel: input.channel }), { price, placement, channel });
      expect(Number.isFinite(row.y)).toBe(true);
      expect(row.painted).toBeGreaterThan(row.samples * (solid ? .98 : .1));
      if (!solid) { expect(row.painted).toBeLessThan(row.samples * .85); expect(row.runs).toBeGreaterThan(3); }
      else expect(row.runs).toBe(1);
    }
  }
  await rows();
  const future = await page.evaluate(() => window.pineVisualFixture.pan(260, 290));
  // LWC clamps its actual range to keep the final real bar on its own timeline.
  expect(future.placements[placement].visible.from).toBeLessThan(256);
  expect(future.placements[placement].visible.to).toBeGreaterThan(256);
  await rows();
  await page.evaluate(() => window.pineVisualFixture.pan(0, 30)); await rows();
  await page.evaluate(() => window.pineVisualFixture.resize()); await rows();
  await capture(page, overlay ? "levels-overlay" : "levels-pane", info.project.name);
  const disposed = await page.evaluate(() => window.pineVisualFixture.dispose());
  expect(disposed[placement].stats.cacheEntries).toBe(0);
  const removed = await page.evaluate((placement) => window.pineVisualFixture.levelProbe(110, { placement, channel: "red" }), placement);
  expect(removed.painted).toBe(0);
  expect(harness.workerRequests).toHaveLength(1);
});

test("hidden null and transparent native levels neither paint nor expand the active scale", async ({ page, harness }, info) => {
  const source = program('hline(100,"Shown",#ff0000,hline.style_solid,2)\nhline(1000000000,"Hidden",#0000ff,hline.style_solid,2,true,display.none)\nhline(-1000000000,"Transparent",#00ff0000,hline.style_solid,2)\nhline(na,"Absent",#0000ff,hline.style_solid,2)\nhline(120,"No color",na,hline.style_solid,2)', true, false);
  const output = await run(page, source, bars, { from: 120, to: 140, bounds: [80, 120] });
  expect(output.placements[0].range.priceRange).toEqual({ minValue: 100, maxValue: 100 });
  expect(output.placements[0].primaryCoordinate).toBeCloseTo(output.placements[0].beforeCoordinate, 8);
  const row = await page.evaluate(() => window.pineVisualFixture.levelProbe(100, { channel: "red" }));
  expect(row.painted).toBeGreaterThan(row.samples * .98);
  const absent = await page.evaluate(() => window.pineVisualFixture.levelProbe(120, { channel: "blue" }));
  expect(absent.painted).toBe(0);
  await capture(page, "levels-exclusions", info.project.name);
});

test("native fixed levels retain coordinates after the real chart timeline advances past their snapshot", async ({ page, harness }, info) => {
  const source = program('hline(160,"Old snapshot level",#ff0000,hline.style_solid,2)');
  const output = await run(page, source, bars.slice(0, 200), { chartBars: bars, from: 240, to: 255, bounds: [80, 120] });
  expect(output.placements[0].range.priceRange).toEqual({ minValue: 160, maxValue: 160 });
  expect(Math.abs(output.placements[0].primaryCoordinate - output.placements[0].beforeCoordinate)).toBeGreaterThan(10);
  expect(output.placements[0].visible.from).toBeGreaterThan(199);
  const initial = await page.evaluate(() => window.pineVisualFixture.levelProbe(160, { channel: "red" }));
  expect(initial.painted).toBeGreaterThan(initial.samples * .98);
  await page.evaluate(() => window.pineVisualFixture.resize());
  const resized = await page.evaluate(() => window.pineVisualFixture.levelProbe(160, { channel: "red" }));
  expect(resized.painted).toBeGreaterThan(resized.samples * .98);
  await capture(page, "levels-advanced-timeline", info.project.name);
  expect(harness.workerRequests).toHaveLength(1);
});

for (const overlay of [true, false]) test("packed 20k fixed levels retain full pane geometry with bounded samples in " + (overlay ? "overlay" : "pane"), async ({ page, harness }, info) => {
  const snapshot = Array.from({ length: 20000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
  const source = program('hline(90,"Lower",#0000ff,hline.style_dashed,2)\nhline(110,"Upper",#ff0000,hline.style_solid,2)', overlay), placement = overlay ? 0 : 1;
  const output = await run(page, source, snapshot, { from: 19994, to: 20024, bounds: [80, 120] });
  expect(output.packed).toEqual([true, true]);
  expect(output.placements[placement].series).toBe(1);
  expect(output.placements[placement].range.priceRange).toEqual({ minValue: 90, maxValue: 110 });
  expect(output.placements[placement].stats.cacheEntries).toBeLessThan(10);
  expect(output.placements[placement].stats.decodedSamples).toBeLessThan(10);
  for (const [from, to] of [[19994, 20024], [10000, 10024]]) {
    const panned = await page.evaluate(input => window.pineVisualFixture.pan(input.from, input.to), { from, to });
    const row = await page.evaluate((placement) => window.pineVisualFixture.levelProbe(110, { placement, channel: "red" }), placement);
    expect(row.painted).toBeGreaterThan(row.samples * .98);
    expect(panned.placements[placement].stats.cacheEntries).toBeLessThan(10);
  }
  await page.evaluate(() => window.pineVisualFixture.resize());
  const resized = await page.evaluate((placement) => window.pineVisualFixture.levelProbe(110, { placement, channel: "red" }), placement);
  expect(resized.painted).toBeGreaterThan(resized.samples * .98);
  await capture(page, overlay ? "levels-packed-overlay" : "levels-packed-pane", info.project.name);
  const disposed = await page.evaluate(() => window.pineVisualFixture.dispose());
  expect(disposed[placement].stats.cacheEntries).toBe(0);
  const removed = await page.evaluate((placement) => window.pineVisualFixture.levelProbe(110, { placement, channel: "red" }), placement);
  expect(removed.painted).toBe(0);
  expect(harness.workerRequests).toHaveLength(1);
});

test("genuine worker keeps solid na six/eight positional overloads solid and unpainted", async ({ page, harness }, info) => {
  for (const variant of [
    { title: "Solid six", tail: 'na,"Solid six",true,3', flags: { editable: true, show_last: 3 } },
    { title: "Solid eight", tail: 'na,"Solid eight",false,3,false,display.none', flags: { editable: false, show_last: 3, fillgaps: false, display: "none" } }
  ]) {
    const output = await run(page, gradientProgram("fill(a,b," + variant.tail + ")"), bars, { from: 240, to: 255 });
    const fill = output.plots.find((plot: any) => plot.name === variant.title);
    expect(fill).toMatchObject({ name: variant.title, style: "fill", options: { color: null, ...variant.flags } });
    expect(fill.options.gradient).toBeUndefined();
    if (variant.flags.display === "none") {
      expect(output.drawn).toEqual([]);
      expect(output.placements[0].series).toBe(0);
      expect(output.placements[0].range).toBeUndefined();
    } else expect(output.placements[0].range).toBeNull();
    expect(output.placements[0].primaryCoordinate).toBeCloseTo(output.placements[0].beforeCoordinate, 8);
    expectPixel(await gradientProbe(page, bars, 254, 100), background);
    expectPixel(await gradientProbe(page, bars, 254, 106), background);
  }
  expect(harness.workerRequests).toHaveLength(2);
  await capture(page, "solid-na-overloads", info.project.name);
});

async function captureShapes78(page: any, name: string, project: string) {
  const directory = path.join(root, ".artifacts/pine-shapes78"); fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, project + "-" + name + ".png"), fullPage: true });
}
test("missing standard Pine shapes paint genuine native signals in both overlay and separate panes", async ({ page, harness }, info) => {
  for (const overlay of [true, false]) {
    const source = program(["cross", "xcross", "diamond", "flag"].map((shape, index) =>
      `plotshape(bar_index==${120 + index * 4}?100:na,"${shape}",style=shape.${shape},location=location.absolute,color=#0000ff,size=size.huge)`
    ).join("\n"), overlay);
    const output = await run(page, source, bars, { from: 116, to: 136 });
    expect(output.drawn, JSON.stringify(output)).toEqual(["cross", "xcross", "diamond", "flag"]);
    expect(output.adapterWarnings.filter((warning: string) => /not drawn|omitt|not rendered/i.test(warning))).toEqual([]);
    const placement = overlay ? 0 : 1;
    expect(output.placements[placement].range.priceRange).toEqual({ minValue: 100, maxValue: 100 });
    for (let index = 0; index < 4; index++) {
      const pixel = await probe(page, 120 + index * 4, 100, { placement, radius: 18 });
      expect(pixel.blue).toBeGreaterThan(8);
    }
    await captureShapes78(page, overlay ? "overlay-shapes" : "pane-shapes", info.project.name);
  }
  expect(harness.workerRequests).toHaveLength(2); expect(harness.otherRequests).toEqual([]);
});
test("pane-edge Pine signals stay pinned through resizing and inversion without changing price scale", async ({ page, harness }, info) => {
  const source = program('plotshape(bar_index==124,"Top",style=shape.flag,location=location.top,color=#ff0000,size=size.large)\nplotshape(bar_index==124,"Bottom",style=shape.diamond,location=location.bottom,color=#00ff00,size=size.large)', false);
  const output = await run(page, source, bars, { from: 116, to: 132 });
  expect(output.drawn, JSON.stringify(output)).toEqual(["Top", "Bottom"]);
  expect(output.placements[1].range).toBeNull();
  expect(output.placements[1].primaryCoordinate).toBe(output.placements[1].beforeCoordinate);
  const inspect = () => page.evaluate(time => window.pineVisualFixture.screenMarkerProbe(time, { placement: 1 }), bars[124].time);
  const initial = await inspect();
  expect(initial.bounds.red).not.toBeNull(); expect(initial.bounds.green).not.toBeNull();
  expect(initial.bounds.red[0]).toBeGreaterThanOrEqual(3); expect(initial.bounds.red[0]).toBeLessThanOrEqual(5);
  expect(initial.height - 1 - initial.bounds.green[1]).toBeGreaterThanOrEqual(3);
  expect(initial.height - 1 - initial.bounds.green[1]).toBeLessThanOrEqual(5);
  await page.evaluate(() => window.pineVisualFixture.invertPriceScale());
  const inverted = await inspect(); expect(inverted.bounds).toEqual(initial.bounds); expect(inverted.range).toBeNull();
  await page.evaluate(() => window.pineVisualFixture.resize());
  const resized = await inspect(); expect(resized.bounds.red).toEqual(initial.bounds.red);
  expect(resized.height - 1 - resized.bounds.green[1]).toBeGreaterThanOrEqual(3);
  expect(resized.height - 1 - resized.bounds.green[1]).toBeLessThanOrEqual(5);
  await captureShapes78(page, "pane-edge-signals", info.project.name);
  const disposed = await page.evaluate(() => window.pineVisualFixture.dispose());
  expect(disposed[1].stats.cacheEntries).toBe(0);
  const removed = await inspect(); expect(removed.bounds.red).toBeNull(); expect(removed.bounds.green).toBeNull();
  expect(harness.workerRequests).toHaveLength(1); expect(harness.otherRequests).toEqual([]);
});

async function captureChars80(page: any, name: string, project: string) {
  const directory = path.join(root, ".artifacts/pine-chars80"); fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, project + "-" + name + ".png"), fullPage: true });
}
test("genuine native character signals paint Unicode offsets defaults and text-only labels", async ({ page, harness }, info) => {
  const body = 'plotchar(bar_index==118?100:na,"Lambda",char="λ",location=location.absolute,color=#0000ff,size=size.huge,offset=2)\n'
    + 'plotchar(bar_index==126?100:na,"Check",char="✓",location=location.absolute,color=#ff0000,size=size.huge,offset=-2)\n'
    + 'plotchar(bar_index==130?100:na,"Text only",char="",location=location.absolute,color=na,text="Text",textcolor=#ffffff,size=size.large)\n'
    + 'plotchar(bar_index==134,"Default star",location=location.top)\n'
    + 'plotchar(bar_index==120?1e9:na,"Invisible",char="λ",location=location.absolute,color=na)';
  for (const overlay of [true, false]) {
    const output = await run(page, program(body, overlay, false), bars, { from: 116, to: 138 });
    expect(output.drawn).toEqual(["Lambda", "Check", "Text only", "Default star", "Invisible"]);
    expect(output.plots.every((plot: any) => plot.style === "char")).toBe(true);
    expect(output.adapterWarnings.some((warning: string) => /not drawn|not rendered/i.test(warning))).toBe(false);
    expect(output.adapterWarnings.some((warning: string) => /local|calibration/i.test(warning))).toBe(true);
    const placement = overlay ? 0 : 1;
    expect(output.placements[placement].range.priceRange).toEqual({ minValue: 100, maxValue: 100 });
    expect((await probe(page, 120, 100, { placement, radius: 18 })).blue).toBeGreaterThan(8);
    expect((await probe(page, 124, 100, { placement, radius: 18 })).red).toBeGreaterThan(8);
    expect((await probe(page, 130, 100, { placement, radius: 32 })).white).toBeGreaterThan(8);
    const star = await page.evaluate(input => window.pineVisualFixture.screenMarkerProbe(input.time, { placement: input.placement, radius: 9 }), { time: bars[134].time, placement });
    expect(star.bounds.cyan).not.toBeNull();
    await captureChars80(page, overlay ? "overlay-characters" : "pane-characters", info.project.name);
  }
  expect(harness.workerRequests).toHaveLength(2); expect(harness.otherRequests).toEqual([]);
});
test("native pane-edge characters stay visible after resize and scale inversion without autoscale leaks", async ({ page, harness }, info) => {
  const source = program('plotchar(bar_index==124,"Top",char="λ",location=location.top,color=#ff0000,size=size.huge)\nplotchar(bar_index==124,"Bottom",char="✓",location=location.bottom,color=#00ff00,size=size.huge)', false);
  const output = await run(page, source, bars, { from: 116, to: 132 });
  expect(output.drawn).toEqual(["Top", "Bottom"]);
  expect(output.placements[1].range).toBeNull();
  expect(output.placements[1].primaryCoordinate).toBe(output.placements[1].beforeCoordinate);
  const inspect = () => page.evaluate(time => window.pineVisualFixture.screenMarkerProbe(time, { placement: 1 }), bars[124].time);
  const initial = await inspect();
  expect(initial.bounds.red).not.toBeNull(); expect(initial.bounds.green).not.toBeNull();
  expect(initial.bounds.red[0]).toBeGreaterThanOrEqual(3); expect(initial.bounds.red[0]).toBeLessThanOrEqual(5);
  expect(initial.height - 1 - initial.bounds.green[1]).toBeGreaterThanOrEqual(3);
  expect(initial.height - 1 - initial.bounds.green[1]).toBeLessThanOrEqual(5);
  await page.evaluate(() => window.pineVisualFixture.invertPriceScale());
  const inverted = await inspect(); expect(inverted.bounds).toEqual(initial.bounds); expect(inverted.range).toBeNull();
  await page.evaluate(() => window.pineVisualFixture.resize());
  const resized = await inspect(); expect(resized.bounds.red).toEqual(initial.bounds.red);
  expect(resized.height - 1 - resized.bounds.green[1]).toBeGreaterThanOrEqual(3);
  expect(resized.height - 1 - resized.bounds.green[1]).toBeLessThanOrEqual(5);
  await captureChars80(page, "pane-edge-characters", info.project.name);
  await page.evaluate(() => window.pineVisualFixture.dispose());
  const removed = await inspect(); expect(removed.bounds.red).toBeNull(); expect(removed.bounds.green).toBeNull();
  expect(harness.workerRequests).toHaveLength(1); expect(harness.otherRequests).toEqual([]);
});
