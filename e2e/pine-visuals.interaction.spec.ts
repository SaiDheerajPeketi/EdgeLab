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
const program = (body: string, overlay = true) => "//@version=6\nindicator(\"Canvas oracle\",overlay=" + overlay + ")\n" + body;
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
async function capture(page: any, name: string, project: string) { const directory = path.join(root, ".artifacts/pine-visuals33"); fs.mkdirSync(directory, { recursive: true }); await page.screenshot({ path: path.join(directory, project + "-" + name + ".png"), fullPage: true }); }
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
    expect(output.warnings.filter((warning: string) => /not drawn|omitt|not rendered/i.test(warning))).toEqual([]);
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
