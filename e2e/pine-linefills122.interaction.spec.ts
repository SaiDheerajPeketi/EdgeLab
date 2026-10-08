import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

declare global { interface Window { pineLinefillsFixture: any; } }
const root = path.resolve(import.meta.dirname, ".."), bytes = fs.readFileSync(path.join(root, "e2e/pine-visuals.bars.json")), bars = JSON.parse(bytes.toString());
const program = (body: string, overlay = true, front = false) => '//@version=6\nindicator("Line fills 122",overlay=' + overlay + (front ? ',behind_chart=false' : '') + ')\n' + body;
type Harness = { origin: string; workerRequests: string[]; otherRequests: string[] };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
    const assets = path.join(root, "frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Build and freeze the production worker before this suite.");
    const workerPath = "/assets/" + workerName;
    const bundled = await build({ entryPoints: [path.join(root, "e2e/pine-linefills122.fixture.ts")], bundle: true, write: false, platform: "browser", format: "iife", globalName: "pineLinefillsFixture",
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "linefills122" }));
        builder.onLoad({ filter: /.*/, namespace: "linefills122" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
      } }] });
    const worker = fs.readFileSync(path.join(assets, workerName)), workerRequests = [], otherRequests = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pine line fills</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}.chart{width:100%;margin-bottom:20px}</style><p id="status" role="status">Awaiting actual production worker</p><div id="main" class="chart"></div><div id="pane" class="chart" hidden></div><script src="/fixture.js"></script>'); }
      else if (pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0].contents); }
      else if (pathname === workerPath) { workerRequests.push(pathname); response.setHeader("Content-Type", "text/javascript"); response.end(worker); }
      else if (pathname === "/favicon.ico") { response.statusCode = 204; response.end(); }
      else { otherRequests.push(pathname); response.statusCode = 404; response.end(); }
    });
    await new Promise<void>(resolve => server.listen(45222, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:45222", workerRequests, otherRequests }); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => { serverHarness.workerRequests.length = 0; serverHarness.otherRequests.length = 0; await page.goto(serverHarness.origin); await use(serverHarness); }
});
async function run(page, source, options = {}, snapshot = bars) {
  const result = await page.evaluate(input => window.pineLinefillsFixture.run(input.source, input.snapshot, input.options), { source, snapshot, options });
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0); return result;
}
const scan = (page, price = 100, options = {}) => page.evaluate(input => window.pineLinefillsFixture.scan(input.price, input.options), { price, options });
function patterned(frame) {
  expect(frame.samples).toBeGreaterThan(150);
  expect(frame.painted).toBeGreaterThan(frame.samples * .1);
  expect(frame.painted).toBeLessThan(frame.samples * .9);
  expect(frame.runs.length).toBeGreaterThan(3);
  expect(frame.gaps.some(n => n >= 2)).toBe(true);
}
function solid(frame) { expect(frame.painted).toBeGreaterThan(frame.samples * .96); expect(frame.runs.length).toBeLessThanOrEqual(2); }


const spot=(page,logical,price,options={})=>page.evaluate(input=>window.pineLinefillsFixture.spot(input.logical,input.price,input.options),{logical,price,options});
const sample=(page,logical,price,placement=0)=>page.evaluate(input=>window.pineLinefillsFixture.sample(input.logical,input.price,input.placement),{logical,price,placement});
const boundaries='var line a=line.new(12,90,33,90,color=na)\nvar line b=line.new(12,110,33,110,color=#00000000)';
const channel=boundaries+'\nvar linefill f=linefill.new(a,b,#ff000080)';
function rgb(actual,expected) {for(let i=0;i<3;i++)expect(Math.abs(actual.rgba[i]-expected[i])).toBeLessThanOrEqual(2);}

test("v5/v6 final channel pixels remain visible between invisible native boundaries with exact alpha and owned references",async({page,harness})=>{
 for(const version of[5,6]) {
  const result=await run(page,program(channel).replace('//@version=6','//@version='+version));
  expect(result.lineFills).toHaveLength(1);expect(result.lineFills[0].line1).toBe(result.lines[0].id);expect(result.lineFills[0].line2).toBe(result.lines[1].id);
  rgb(await sample(page,20,100),[136,12,19]);expect((await spot(page,20,85)).ink).toBe(0);expect(result.warnings.some(w=>/UNSUPPORTED_DRAWING/.test(w))).toBe(false);
 }
 expect(harness.workerRequests.length).toBeGreaterThan(0);expect(harness.otherRequests).toEqual([]);
});
test("same-pair replacement uses its new color while stale fill setters are inert; NA method colors hide paint",async({page,harness})=>{
 const body=channel+'\nif bar_index==1\n    linefill.new(b,a,#0000ff80)\nif bar_index==2\n    f.set_color(#00ff0080)';
 const result=await run(page,program(body));expect(result.lineFills).toHaveLength(1);expect(result.lineFills[0].color).toBe("#0000ff80");rgb(await sample(page,20,100),[8,12,147]);
 for(const call of['linefill.set_color(f,na)','f.set_color(na)','f.set_color(color(na))']) {
  const hidden=await run(page,program(channel+'\nif bar_index==1\n    '+call));expect(hidden.lineFills[0].color).toBe(null);rgb(await sample(page,20,100),[17,24,39]);
 }
 expect(harness.otherRequests).toEqual([]);
});
test("crossing lobes fill their common span exactly once while non-overlapping, zero-area and mixed-pane fills stay absent",async({page,harness})=>{
 await run(page,program('var line a=line.new(12,90,33,110,color=na)\nvar line b=line.new(12,110,33,90,color=na)\nlinefill.new(a,b,#ff000080)'));
 rgb(await sample(page,16,100),[136,12,19]);rgb(await sample(page,29,100),[136,12,19]);rgb(await sample(page,22.5,109),[17,24,39]);
 const separate=await run(page,program('var line a=line.new(12,90,17,90,color=na)\nvar line b=line.new(23,110,33,110,color=na)\nlinefill.new(a,b,#ff000080)'));expect(separate.lineFills).toHaveLength(1);rgb(await sample(page,20,100),[17,24,39]);
 await run(page,program('var line a=line.new(20,90,20,110,color=na)\nvar line b=line.new(20,95,20,115,color=na)\nlinefill.new(a,b,#ff000080)'));rgb(await sample(page,20,100),[17,24,39]);
 const mixed=await run(page,program(channel.replace('color=#00000000','color=#00000000,force_overlay=true'),false));expect(mixed.lineFills[0].overlay).toBe(true);expect(mixed.warnings.some(w=>/fill/i.test(w)&&/pane|placement/i.test(w))).toBe(true);rgb(await sample(page,20,100),[17,24,39]);
 expect(harness.otherRequests).toEqual([]);
});
test("extensions fill only shared directions through pan resize and disposal",async({page,harness})=>{
 for(const[first,second,left,right]of[["right","right",false,true],["both","right",false,true],["both","left",true,false],["left","right",false,false],["none","both",false,false]]) {
  await run(page,program(channel+'\na.set_extend(extend.'+first+')\nb.set_extend(extend.'+second+')'));
  expect((await spot(page,11,100)).ink>0).toBe(left);expect((await spot(page,34,100)).ink>0).toBe(right);
 }
 await run(page,program(channel+'\na.set_extend(extend.right)\nb.set_extend(extend.right)'));await page.evaluate(()=>window.pineLinefillsFixture.pan(55,70));rgb(await sample(page,60,100),[136,12,19]);await page.evaluate(()=>window.pineLinefillsFixture.resize());rgb(await sample(page,60,100),[136,12,19]);await page.evaluate(()=>window.pineLinefillsFixture.dispose());rgb(await sample(page,60,100),[17,24,39]);expect(harness.otherRequests).toEqual([]);
});
test("replay truncation respects explicit deletion and line deletion or GC cascade without stale filled regions",async({page,harness})=>{
 for(const action of['f.delete()','a.delete()','line.new(20,100,30,100,color=na)']) {
  const source=program(channel+'\nif bar_index==20\n    '+action).replace('overlay=true','overlay=true,max_lines_count=2');
  const before=await run(page,source,{},bars.slice(0,20));expect(before.lineFills).toHaveLength(1);rgb(await sample(page,17,100),[136,12,19]);
  const after=await run(page,source,{},bars.slice(0,21));expect(after.lineFills).toEqual([]);rgb(await sample(page,17,100),[17,24,39]);
 }
 expect(harness.otherRequests).toEqual([]);
});
test("fills respect actual logarithmic and inverted boundary geometry without expanding an established price scale",async({page,harness})=>{
 const body='var line a=line.new(12,20,33,200,color=na)\nvar line b=line.new(12,50,33,300,color=na)\nlinefill.new(a,b,#ff000080)';
 await run(page,program(body),{bounds:[10,400]});
 for(const invert of[false,true]) {
  await page.evaluate(input=>window.pineLinefillsFixture.scale(1,input.invert),{invert});rgb(await sample(page,22.5,90),[136,12,19]);rgb(await sample(page,22.5,160),[17,24,39]);
 }
 expect(harness.otherRequests).toEqual([]);
});
test("persistent worker rolls provisional colors, replacements, deletions and cascade GC back on a no-branch tick",async({page,harness})=>{
 const candle=(i,close)=>({time:bars[0].time+i*60,open:close,high:close+1,low:close-1,close,volume:20}),snapshot=Array.from({length:8},(_,i)=>candle(i,100));
 const base='var line a=line.new(1,90,6,90,color=na)\nvar line b=line.new(1,110,6,110,color=na)\nvar linefill f=linefill.new(a,b,#ff000080)';
 for(const action of['f.set_color(#0000ff80)','linefill.new(b,a,#0000ff80)','f.delete()','a.delete()','line.new(8,100,9,100,color=na)']) {
  const source=program(base+'\nif barstate.isrealtime and close>105\n    '+action).replace('overlay=true','overlay=true,max_lines_count=2');
  const initial=await page.evaluate(input=>window.pineLinefillsFixture.startLive(input.source,input.snapshot,{from:0,to:10}),{source,snapshot});expect(initial.lineFills).toHaveLength(1);rgb(await sample(page,4,100),[136,12,19]);
  const provisional=await page.evaluate(input=>window.pineLinefillsFixture.updateLive(input.bar,false),{bar:candle(8,110)});expect(provisional.lineFills).not.toEqual(initial.lineFills);
  const restored=await page.evaluate(input=>window.pineLinefillsFixture.updateLive(input.bar,false),{bar:candle(8,95)});expect(restored.lineFills).toEqual(initial.lineFills);rgb(await sample(page,4,100),[136,12,19]);await page.evaluate(()=>window.pineLinefillsFixture.dispose());
 }
 expect(harness.workerRequests).toHaveLength(5);expect(harness.otherRequests).toEqual([]);
});
test("forced boundary pairs draw their fill on the main chart and a fill-only hidden-boundary study can seed an empty pane",async({page,harness})=>{
 const forced=await run(page,program(channel.replace(/color=na/g,'color=na,force_overlay=true').replace('color=#00000000','color=#00000000,force_overlay=true'),false));expect(forced.lineFills[0].overlay).toBe(true);rgb(await sample(page,20,100),[136,12,19]);
 const seeded=await run(page,program(channel,false),{lineOnly:true,from:10,to:35});expect(seeded.placements).toHaveLength(2);expect(seeded.placements[1].range.priceRange.minValue).toBeCloseTo(90,8);expect(seeded.placements[1].range.priceRange.maxValue).toBeCloseTo(110,8);rgb(await sample(page,20,100,1),[136,12,19]);expect(harness.otherRequests).toEqual([]);
});

test("empty fill-only panes seed from visible area despite background NA or offscreen peers; actual visible numeric peers prevent scale expansion",async({page,harness})=>{
 for(const peer of['bgcolor(na)','plot(na,"Empty")','plot(bar_index==0?1000000:na,"Old")']) {
  const result=await run(page,program(channel+'\n'+peer),{lineOnly:true,from:10,to:35});expect(result.placements[0].drawingRange.priceRange.minValue).toBeCloseTo(90,8);expect(result.placements[0].drawingRange.priceRange.maxValue).toBeCloseTo(110,8);rgb(await sample(page,20,100),[136,12,19]);
 }
 const numeric=await run(page,program(channel+'\nplot(1000000,"Peer")'),{lineOnly:true,from:10,to:35});expect(numeric.placements[0].drawingRange).toBe(null);expect(numeric.placements[0].range.priceRange).toEqual({minValue:1000000,maxValue:1000000});expect((await scan(page,100,{from:14,to:31})).painted).toBe(0);
 expect(harness.otherRequests).toEqual([]);
});
test("clipped fill-only autoscale follows real logarithmic and inverted screen interpolation, and extreme finite bands paint only clipped viewport",async({page,harness})=>{
 const body='var line a=line.new(0,10,10,1000,color=na)\nvar line b=line.new(0,1,10,100,color=na)\nlinefill.new(a,b,#ff000080)';
 await run(page,program(body),{lineOnly:true,from:4,to:6},bars.slice(0,12));
 for(const invert of[false,true]) {
  const result=await page.evaluate(input=>window.pineLinefillsFixture.scale(1,input.invert),{invert}),range=result.placements[0].drawingRange.priceRange,viewport=result.placements[0].visible;
  // Pinned LWC interpolates log10(price + 0.0001), then subtracts the shift.
    const logInterpolate=(a:number,b:number,t:number)=>(a+0.0001)**(1-t)*(b+0.0001)**t-0.0001;
    const expectedMin=logInterpolate(1,100,viewport.from/10),expectedMax=logInterpolate(10,1000,viewport.to/10);expect(Math.abs(range.minValue/expectedMin-1)).toBeLessThan(1e-8);expect(Math.abs(range.maxValue/expectedMax-1)).toBeLessThan(1e-8);
  rgb(await sample(page,5,30),[136,12,19]);
 }
 const huge=await run(page,program('var line a=line.new(12,-1e100,33,-1e100,color=na,extend=extend.both)\nvar line b=line.new(12,1e100,33,1e100,color=na,extend=extend.both)\nlinefill.new(a,b,#ff000080)'));
 expect(huge.placements[0].drawingRange).toBe(null);rgb(await sample(page,20,100),[136,12,19]);expect(harness.otherRequests).toEqual([]);
});
