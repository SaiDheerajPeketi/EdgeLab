import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

declare global { interface Window { pineLinestyleFixture: any; } }
const root = path.resolve(import.meta.dirname, ".."), bytes = fs.readFileSync(path.join(root, "e2e/pine-visuals.bars.json")), bars = JSON.parse(bytes.toString());
const program = (body: string, overlay = true, front = false) => '//@version=6\nindicator("Line style 86",overlay=' + overlay + (front ? ',behind_chart=false' : '') + ')\n' + body;
type Harness = { origin: string; workerRequests: string[]; otherRequests: string[] };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
    const assets = path.join(root, "frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Build and freeze the production worker before this suite.");
    const workerPath = "/assets/" + workerName;
    const bundled = await build({ entryPoints: [path.join(root, "e2e/pine-linestyle86.fixture.ts")], bundle: true, write: false, platform: "browser", format: "iife", globalName: "pineLinestyleFixture",
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "linestyle86" }));
        builder.onLoad({ filter: /.*/, namespace: "linestyle86" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
      } }] });
    const worker = fs.readFileSync(path.join(assets, workerName)), workerRequests = [], otherRequests = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pine line styles</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}.chart{width:100%;margin-bottom:20px}</style><p id="status" role="status">Awaiting actual production worker</p><div id="main" class="chart"></div><div id="pane" class="chart" hidden></div><script src="/fixture.js"></script>'); }
      else if (pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0].contents); }
      else if (pathname === workerPath) { workerRequests.push(pathname); response.setHeader("Content-Type", "text/javascript"); response.end(worker); }
      else if (pathname === "/favicon.ico") { response.statusCode = 204; response.end(); }
      else { otherRequests.push(pathname); response.statusCode = 404; response.end(); }
    });
    await new Promise<void>(resolve => server.listen(45186, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:45186", workerRequests, otherRequests }); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => { serverHarness.workerRequests.length = 0; serverHarness.otherRequests.length = 0; await page.goto(serverHarness.origin); await use(serverHarness); }
});
async function run(page, source, options = {}, snapshot = bars) {
  const result = await page.evaluate(input => window.pineLinestyleFixture.run(input.source, input.snapshot, input.options), { source, snapshot, options });
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0); return result;
}
const scan = (page, price = 100, options = {}) => page.evaluate(input => window.pineLinestyleFixture.scan(input.price, input.options), { price, options });
function patterned(frame) {
  expect(frame.samples).toBeGreaterThan(150);
  expect(frame.painted).toBeGreaterThan(frame.samples * .1);
  expect(frame.painted).toBeLessThan(frame.samples * .9);
  expect(frame.runs.length).toBeGreaterThan(3);
  expect(frame.gaps.some(n => n >= 2)).toBe(true);
}
function solid(frame) { expect(frame.painted).toBeGreaterThan(frame.samples * .96); expect(frame.runs.length).toBeLessThanOrEqual(2); }

test("documented 16th positional and mixed named enums reach real dash and dot gaps; omitted style stays solid", async ({ page, harness }) => {
  const result = await run(page, program('plot(90,"Default",color=#ff0000,linewidth=2)\nplot(100,"Positional",#00ff00,2,plot.style_line,false,0,0,false,true,256,display.all,format.price,2,false,plot.linestyle_dashed)\nplot(110,"Mixed",#0000ff,2,style=plot.style_line,linestyle=plot.linestyle_dotted)'));
  expect(result.plots.map(p => p.options.linestyle)).toEqual([undefined, "linestyle_dashed", "linestyle_dotted"]);
  solid(await scan(page, 90, { from: 12, to: 33 }));
  const dash = await scan(page, 100, { channel: "green", from: 12, to: 33 }), dot = await scan(page, 110, { channel: "blue", from: 12, to: 33 });
  patterned(dash); patterned(dot); expect(Math.max(...dash.runs)).toBeGreaterThan(Math.max(...dot.runs));
  expect(harness.workerRequests).toHaveLength(1); expect(harness.otherRequests).toEqual([]);
});

test("prepared custom input IDs rerun solid dashed and dotted constants with distinct pixels", async ({ page, harness }) => {
  const source = program('choice=input.string("Solid","Stroke",options=["Solid","Dashed","Dotted"])\nstroke=choice=="Dashed"?plot.linestyle_dashed:choice=="Dotted"?plot.linestyle_dotted:plot.linestyle_solid\nplot(100,"Input",color=#ff0000,linewidth=2,linestyle=stroke)');
  const prepared = await page.evaluate(source => window.pineLinestyleFixture.prepare(source), source);
  const id = prepared.inputDefinitions.find(d => d.title === "Stroke").id;
  const omitted = await run(page, source); expect(omitted.plots[0].options.linestyle).toBe("linestyle_solid"); solid(await scan(page, 100, { from: 12, to: 33 }));
  for (const choice of ["Dashed", "Dotted"]) {
    const inputs = { [id]: choice }, result = await run(page, source, { inputs });
    expect(result.inputs).toEqual(inputs); expect(result.plots[0].options.linestyle).toBe("linestyle_" + choice.toLowerCase());
    patterned(await scan(page, 100, { from: 12, to: 33 }));
  }
  expect(harness.workerRequests.length).toBeGreaterThan(0); expect(harness.otherRequests).toEqual([]);
});

test("all five documented line-bearing styles paint dash gaps; area fill stays continuous below its outline", async ({ page, harness }) => {
  for (const style of ["line", "linebr", "stepline", "stepline_diamond", "area"]) {
    const source = program('plot(100,"Eligible",color=#ff0000,linewidth=3,style=plot.style_' + style + ',histbase=80,linestyle=plot.linestyle_dashed)');
    await run(page, source);
    patterned(await scan(page, 100, { from: 12, to: 33, dy: style === "area" ? -1 : 0 }));
    if (style === "area") solid(await scan(page, 95, { from: 12, to: 33 }));
  }
  expect(harness.otherRequests).toEqual([]);
});

test("linebr respects na gaps while ordinary dashed lines bridge them; show_last and signed offsets stay source based", async ({ page, harness }) => {
  const body = 'plot(bar_index>=18 and bar_index<=24?na:100,"Gap",color=#ff0000,linewidth=2,style=plot.style_';
  await run(page, program(body + 'line,linestyle=plot.linestyle_dashed)'));
  expect((await scan(page, 100, { from: 19, to: 23 })).painted).toBeGreaterThan(0);
  await run(page, program(body + 'linebr,linestyle=plot.linestyle_dashed)'));
  expect((await scan(page, 100, { from: 19, to: 23 })).painted).toBe(0);
  const snapshot = bars.slice(0, 40);
  for (const offset of [-3, 3]) {
    await run(page, program('plot(100,"Tail",color=#ff0000,linewidth=2,show_last=7,offset=' + offset + ',linestyle=plot.linestyle_dashed)'), { from: 23, to: 45 }, snapshot);
    expect((await scan(page, 100, { from: 25, to: 28 })).painted).toBe(0);
    expect((await scan(page, 100, { from: 34 + offset, to: 38 + offset })).painted).toBeGreaterThan(0);
  }
  expect(harness.otherRequests).toEqual([]);
});

test("pan zoom resize and display.none preserve real dash gaps and exclude hidden prices", async ({ page, harness }, info) => {
  const output = await run(page, program('plot(100,"Visible",color=#ff0000,linewidth=2,linestyle=plot.linestyle_dashed)\nplot(1000000,"Hidden",color=#0000ff,display=display.none,linestyle=plot.linestyle_dotted)'));
  expect(output.plots).toHaveLength(2); expect(output.placements[0].range.priceRange).toEqual({ minValue: 100, maxValue: 100 });
  patterned(await scan(page, 100, { from: 12, to: 33 }));
  await page.evaluate(() => window.pineLinestyleFixture.pan(55, 70));
  const zoomed = await scan(page, 100, { from: 57, to: 68 }); patterned(zoomed);
  await page.evaluate(() => window.pineLinestyleFixture.resize()); patterned(await scan(page, 100, { from: 57, to: 68 }));
  await page.screenshot({ path: path.join(root, ".artifacts", "pine-linestyle86-" + info.project.name + ".png"), fullPage: true });
  expect(harness.otherRequests).toEqual([]);
});

test("non-line styles ignore linestyle; front and behind-chart layers differ on actual candle pixels", async ({ page, harness }) => {
  for (const style of ["areabr", "steplinebr", "columns", "circles"]) {
    const body = 'plot(100,"Unaffected",color=#ff0000,linewidth=2,histbase=80,style=plot.style_' + style;
    await run(page, program(body + ')')); const before = await scan(page, 100, { from: 12, to: 33 });
    await run(page, program(body + ',linestyle=plot.linestyle_dashed)')); const after = await scan(page, 100, { from: 12, to: 33 });
    expect(after.mask).toEqual(before.mask);
  }
  const candles = bars.map(b => ({ ...b, open: 100, high: 104, low: 96, close: 100 }));
  const body = 'plot(100,"Layer",color=#ff0000,linewidth=3,linestyle=plot.linestyle_dashed)';
  await run(page, program(body), { candles: true, chartBars: candles }); const behind = await scan(page, 100, { from: 12, to: 33 });
  await run(page, program(body, true, true), { candles: true, chartBars: candles }); const front = await scan(page, 100, { from: 12, to: 33 });
  expect(front.painted).toBeGreaterThan(behind.painted + 3);
  expect(harness.otherRequests).toEqual([]);
});

test("persistent production worker rolls back ordinary variables and redraws live dashed prices through confirmation", async ({ page, harness }) => {
  const candle = (index, close) => ({ time: bars[0].time + index * 60, open: close, high: close + 1, low: close - 1, close, volume: 10 });
  const snapshot = Array.from({ length: 8 }, (_, i) => candle(i, 100));
  const source = program('var int ordinary=0\nvarip int ticks=0\nordinary+=1\nticks+=1\nplot(close,"Signal",color=#ff0000,linewidth=2,style=plot.style_stepline,linestyle=plot.linestyle_dashed)\nplot(ordinary,"Rollback",display=display.none)\nplot(ticks,"Ticks",display=display.none)');
  let result = await page.evaluate(input => window.pineLinestyleFixture.startLive(input.source, input.snapshot, { from: 0, to: 10 }), { source, snapshot });
  expect(result.plots[0].points.map(p => p.value)).toEqual(Array(8).fill(100));
  for (const [sequence, [close, confirmed]] of [[110, false], [90, false], [105, true]].entries()) {
    result = await page.evaluate(input => window.pineLinestyleFixture.updateLive(input.bar, input.confirmed), { bar: candle(8, close as number), confirmed });
    expect(result.plots[0].points.map(p => p.value)).toEqual([...Array(8).fill(100), close]);
    expect(result.plots[0].options.linestyle).toBe("linestyle_dashed");
    expect(result.plots.find(p => p.name === "Rollback").points.at(-1).value).toBe(9);
    expect(result.plots.find(p => p.name === "Ticks").points.at(-1).value).toBe(9 + sequence);
    const frame = await scan(page, close as number, { from: 7.8, to: 8.2, radius: 8 });
    expect(frame.painted).toBeGreaterThan(0);
    if (sequence > 0) expect((await scan(page, sequence === 1 ? 110 : 90, { from: 7.8, to: 8.2, radius: 8 })).painted).toBe(0);
  }
  result = await page.evaluate(input => window.pineLinestyleFixture.updateLive(input.bar, true), { bar: candle(9, 100) });
  expect(result.plots[0].points.map(p => p.value)).toEqual([...Array(8).fill(100), 105, 100]);
  expect(result.plots.find(p => p.name === "Rollback").points.at(-1).value).toBe(10);
  expect(harness.workerRequests).toHaveLength(1); expect(harness.otherRequests).toEqual([]);
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(1);
  await page.evaluate(() => window.pineLinestyleFixture.dispose());
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0);
});

test("invalid bare strings changing enums and na styles fail explicitly through the production worker", async ({ page, harness }) => {
  for (const expression of ['"dashed"', 'na', 'bar_index%2==0?plot.linestyle_dashed:plot.linestyle_dotted']) {
    const actual = await page.evaluate(async input => { try { await window.pineLinestyleFixture.run(input.source, input.bars); return ""; } catch (e) { return String(e); } }, { source: program('plot(100,linestyle=' + expression + ')'), bars: bars.slice(0, 4) });
    expect(actual).toMatch(/linestyle|line style|constant/i);
  }
  expect(harness.otherRequests).toEqual([]);
});

test("20,000-bar packed worker output retains style while pan and disposal bound decoded canvas samples", async ({ page, harness }) => {
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[index % bars.length], time: bars[0].time + index * 60 }));
  const output = await run(page, program('plot(100,"Packed",color=#ff0000,linewidth=2,linestyle=plot.linestyle_dashed)'), { from: 19965, to: 19990 }, snapshot);
  expect(output.packed).toEqual([true]);
  expect(output.plots[0].options.linestyle).toBe("linestyle_dashed");
  expect(output.placements[0].stats.cacheEntries).toBeLessThan(200);
  patterned(await scan(page, 100, { from: 19967, to: 19988 }));
  const panned = await page.evaluate(() => window.pineLinestyleFixture.pan(25, 50));
  expect(panned.placements[0].stats.cacheEntries).toBeLessThan(200);
  patterned(await scan(page, 100, { from: 27, to: 48 }));
  const disposed = await page.evaluate(() => window.pineLinestyleFixture.dispose());
  expect(disposed.every(stats => stats.cacheEntries === 0)).toBe(true);
  expect(harness.workerRequests).toHaveLength(1); expect(harness.otherRequests).toEqual([]);
});

test("offset diamond steps add filled ink only at retained value changes, with unchanged plateaus matching ordinary steps", async ({ page, harness }) => {
  const body = 'plot(bar_index<10?90:bar_index<22?96:bar_index<25?104:108,"Steps",color=#ff0000,linewidth=2,offset=2,show_last=240,linestyle=plot.linestyle_dashed,style=plot.style_';
  const spots = [{ logical: 24, price: 104 }, { logical: 27, price: 108 }, { logical: 25, price: 104 }];
  await run(page, program(body + 'stepline)'), { from: 18, to: 30 });
  const plain = [];
  for (const spot of spots) plain.push(await scan(page, spot.price, { from: spot.logical - .3, to: spot.logical + .3, radius: 6 }));
  await run(page, program(body + 'stepline_diamond)'), { from: 18, to: 30 });
  const diamond = [];
  for (const spot of spots) diamond.push(await scan(page, spot.price, { from: spot.logical - .3, to: spot.logical + .3, radius: 6 }));
  expect(diamond[0].ink).toBeGreaterThan(plain[0].ink + 8);
  expect(diamond[1].ink).toBeGreaterThan(plain[1].ink + 8);
  // Diamond autoscale margins can move an antialiased stroke by a fraction of a pixel.
  expect(Math.abs(diamond[2].ink - plain[2].ink)).toBeLessThanOrEqual(2);
  await page.evaluate(() => window.pineLinestyleFixture.pan(8, 16));
  expect((await scan(page, 96, { from: 11.7, to: 12.3, radius: 6 })).ink).toBe(0);
  expect(harness.otherRequests).toEqual([]);
});
