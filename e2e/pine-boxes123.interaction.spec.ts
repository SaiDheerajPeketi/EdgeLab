import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

declare global { interface Window { pineBoxesFixture: any; } }
const root = path.resolve(import.meta.dirname, ".."), bytes = fs.readFileSync(path.join(root, "e2e/pine-visuals.bars.json")), bars = JSON.parse(bytes.toString());
const program = (body: string, overlay = true, front = false) => '//@version=6\nindicator("Boxes 123",overlay=' + overlay + (front ? ',behind_chart=false' : '') + ')\n' + body;
type Harness = { origin: string; workerRequests: string[]; otherRequests: string[] };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
    const assets = path.join(root, "frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Build and freeze the production worker before this suite.");
    const workerPath = "/assets/" + workerName;
    const bundled = await build({ entryPoints: [path.join(root, "e2e/pine-boxes123.fixture.ts")], bundle: true, write: false, platform: "browser", format: "iife", globalName: "pineBoxesFixture",
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "boxes123" }));
        builder.onLoad({ filter: /.*/, namespace: "boxes123" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
      } }] });
    const worker = fs.readFileSync(path.join(assets, workerName)), workerRequests = [], otherRequests = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pine boxes</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}.chart{width:100%;margin-bottom:20px}</style><p id="status" role="status">Awaiting actual production worker</p><div id="main" class="chart"></div><div id="pane" class="chart" hidden></div><script src="/fixture.js"></script>'); }
      else if (pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0].contents); }
      else if (pathname === workerPath) { workerRequests.push(pathname); response.setHeader("Content-Type", "text/javascript"); response.end(worker); }
      else if (pathname === "/favicon.ico") { response.statusCode = 204; response.end(); }
      else { otherRequests.push(pathname); response.statusCode = 404; response.end(); }
    });
    await new Promise<void>(resolve => server.listen(45223, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:45223", workerRequests, otherRequests }); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => { serverHarness.workerRequests.length = 0; serverHarness.otherRequests.length = 0; await page.goto(serverHarness.origin); await use(serverHarness); }
});
async function run(page, source, options = {}, snapshot = bars) {
  const result = await page.evaluate(input => window.pineBoxesFixture.run(input.source, input.snapshot, input.options), { source, snapshot, options });
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0); return result;
}
const zone='var box a=box.new(12,110,33,90,border_color=na,bgcolor=#ff000080)';
const sample=(page,logical,price,placement=0)=>page.evaluate(input=>window.pineBoxesFixture.sample(input.logical,input.price,input.placement),{logical,price,placement});
const spot=(page,logical,price,options={})=>page.evaluate(input=>window.pineBoxesFixture.spot(input.logical,input.price,input.options),{logical,price,options});
const glyphs=(page,left,right,top,bottom,options={})=>page.evaluate(input=>window.pineBoxesFixture.glyphs(input.left,input.right,input.top,input.bottom,input.options),{left,right,top,bottom,options});
function rgb(actual,expected){for(let i=0;i<3;i++)expect(Math.abs(actual.rgba[i]-expected[i])).toBeLessThanOrEqual(2);}

test('v5/v6 actual boxes paint authored alpha corners without invented timelines and clean ownership',async({page,harness})=>{
 for(const version of[5,6]){
  const result=await run(page,program(zone).replace('//@version=6','//@version='+version));expect(result.boxes).toHaveLength(1);expect(result.boxes[0].borderColor).toBe(null);rgb(await sample(page,20,100),[136,12,19]);rgb(await sample(page,11,100),[17,24,39]);rgb(await sample(page,34,100),[17,24,39]);rgb(await sample(page,20,115),[17,24,39]);
 }
 await page.evaluate(()=>window.pineBoxesFixture.dispose());rgb(await sample(page,20,100),[17,24,39]);expect(harness.workerRequests.length).toBeGreaterThan(0);expect(harness.otherRequests).toEqual([]);
});
test('NA and transparent colors hide independently while zero-area borders remain meaningful lines',async({page,harness})=>{
 for(const color of['na','color(na)','#ff000000']){const result=await run(page,program('var box a=box.new(12,110,33,90,border_color='+color+',bgcolor='+color+',text="Hidden",text_color='+color+')'));expect(result.boxes).toHaveLength(1);rgb(await sample(page,20,100),[17,24,39]);expect((await glyphs(page,12,33,110,90,{channel:'red'})).ink).toBe(0);}
 await run(page,program('var box a=box.new(20,110,20,90,border_color=#ff0000,bgcolor=#ff0000,border_width=3)'));expect((await spot(page,20,100)).ink).toBeGreaterThan(0);rgb(await sample(page,23,100),[17,24,39]);
 await run(page,program('var box a=box.new(12,100,33,100,border_color=#ff0000,bgcolor=#ff0000,border_width=3)'));expect((await spot(page,20,100)).ink).toBeGreaterThan(0);rgb(await sample(page,20,105),[17,24,39]);
 await run(page,program('var box a=box.new(20,100,20,100,border_color=#ff0000,bgcolor=#ff0000)'));expect((await spot(page,20,100)).ink).toBe(0);expect(harness.otherRequests).toEqual([]);
});
test('text alignment follows original box corners and wrap-auto clips while nowrap allows documented horizontal overflow',async({page,harness})=>{
 const body=(ha,va,wrap='none',text='Demand')=>'var box a=box.new(12,110,33,90,border_color=na,bgcolor=na,text='+JSON.stringify(text)+',text_color=#00ff00,text_size=24,text_halign=text.align_'+ha+',text_valign=text.align_'+va+',text_wrap=text.wrap_'+wrap+',text_font_family=font.family_monospace,text_formatting=text.format_bold+text.format_italic)';
 for(const[ha,va]of[['left','top'],['center','center'],['right','bottom']]){
  const result=await run(page,program(body(ha,va)));expect(result.boxes[0].textFormatting).toBe('bolditalic');const ink=await glyphs(page,12,33,110,90);expect(ink.ink).toBeGreaterThan(30);
  if(ha==='left')expect(ink.minX-ink.bounds.left).toBeLessThan(15);if(ha==='right')expect(ink.bounds.right-ink.maxX).toBeLessThan(15);if(va==='top')expect(ink.minY-ink.bounds.top).toBeLessThan(20);if(va==='bottom')expect(ink.bounds.bottom-ink.maxY).toBeLessThan(20);
 }
 const words='Demand zone demand zone demand zone demand zone demand zone';
 await run(page,program(body('left','top','none',words).replace('33,90','19,90')));const nowrap=await glyphs(page,12,35,110,90),outside=await glyphs(page,20,33,110,90);expect(nowrap.ink).toBeGreaterThan(0);expect(outside.ink).toBeGreaterThan(0);
 await run(page,program(body('left','top','auto',words).replace('33,90','19,90')));const wrapped=await glyphs(page,12,19,110,90);expect(wrapped.ink).toBeGreaterThan(0);expect(wrapped.maxY-wrapped.minY).toBeGreaterThan(nowrap.maxY-nowrap.minY);expect((await glyphs(page,20,33,110,90)).ink).toBe(0);
 await page.evaluate(()=>window.pineBoxesFixture.pan(17,35));await page.evaluate(()=>window.pineBoxesFixture.resize());expect((await glyphs(page,20,33,110,90)).ink).toBe(0);expect(harness.otherRequests).toEqual([]);
});
test('extended horizontal borders pan and resize independently from finite fill and vertical sides',async({page,harness})=>{
 for(const[extend,left,right]of[['none',false,false],['left',true,false],['right',false,true],['both',true,true]]){
  await run(page,program('var box a=box.new(12,110,33,90,border_color=#ff0000,border_width=3,bgcolor=#0000ff80,extend=extend.'+extend+')'));
  expect((await spot(page,11,110)).ink>0).toBe(left);expect((await spot(page,34,110)).ink>0).toBe(right);rgb(await sample(page,20,100),[8,12,147]);rgb(await sample(page,11,100),[17,24,39]);rgb(await sample(page,34,100),[17,24,39]);
 }
 await page.evaluate(()=>window.pineBoxesFixture.pan(55,70));expect((await spot(page,60,110)).ink).toBeGreaterThan(0);rgb(await sample(page,60,100),[17,24,39]);await page.evaluate(()=>window.pineBoxesFixture.resize());expect((await spot(page,60,110)).ink).toBeGreaterThan(0);await page.evaluate(()=>window.pineBoxesFixture.dispose());expect((await spot(page,60,110)).ink).toBe(0);expect(harness.otherRequests).toEqual([]);
});
test('bar-time box geometry maps the genuine shared timeline instead of authored array indices',async({page,harness})=>{
 const source=program('var box a=box.new(time+12*60000,110,time+33*60000,90,border_color=na,bgcolor=#ff000080,xloc=xloc.bar_time)');const timed=await run(page,source);expect(timed.boxes[0].left).toBe(bars[0].time+12*60);rgb(await sample(page,20,100),[136,12,19]);
 const chartBars=bars.flatMap((bar,i)=>i===bars.length-1?[bar]:[bar,{...bar,time:bar.time+30}]);await run(page,program(zone),{chartBars,from:20,to:70});rgb(await sample(page,40,100),[136,12,19]);rgb(await sample(page,22,100),[17,24,39]);expect(harness.otherRequests).toEqual([]);
});
test('forced overlay and separate text-only pane retain placement and seed empty chart scale without inventing numeric outputs',async({page,harness})=>{
 const forced=await run(page,program(zone.replace('bgcolor=#ff000080','bgcolor=#ff000080,force_overlay=true'),false));expect(forced.boxes[0].overlay).toBe(true);rgb(await sample(page,20,100),[136,12,19]);
 const textOnly='var box a=box.new(12,110,33,90,border_color=na,bgcolor=na,text="Demand",text_color=#00ff00,text_size=24)';const pane=await run(page,program(textOnly,false),{lineOnly:true});expect(pane.plots).toEqual([]);expect(pane.placements).toHaveLength(2);expect(pane.placements[1].drawingRange.priceRange).toEqual({minValue:90,maxValue:110});expect((await glyphs(page,12,33,110,90,{placement:1})).ink).toBeGreaterThan(20);
 const main=await run(page,program(zone),{lineOnly:true});expect(main.placements[0].drawingRange.priceRange).toEqual({minValue:90,maxValue:110});rgb(await sample(page,20,100),[136,12,19]);expect(harness.otherRequests).toEqual([]);
});
test('log and inverted chart scales preserve horizontal box prices, fills, text and clipped magnitude pixels',async({page,harness})=>{
 await run(page,program('var box a=box.new(12,300,33,50,border_color=#ff0000,bgcolor=#ff000080,text="Demand",text_color=#00ff00)'),{bounds:[10,400]});for(const invert of[false,true]){await page.evaluate(input=>window.pineBoxesFixture.scale(1,input.invert),{invert});rgb(await sample(page,16,100),[136,12,19]);rgb(await sample(page,16,20),[17,24,39]);expect((await spot(page,16,300)).ink).toBeGreaterThan(0);expect((await glyphs(page,12,33,300,50)).ink).toBeGreaterThan(0);}
 await run(page,program('var box a=box.new(12,1e100,33,-1e100,border_color=na,bgcolor=#ff000080)'));
 // Set the authored viewport after genuine LWC axis-width layout has settled.
 await page.evaluate(()=>window.pineBoxesFixture.pan(10,35));const inside=await sample(page,20,100),outside=await sample(page,11,100);expect(inside.x).toBeGreaterThan(0);expect(outside.x).toBeGreaterThan(0);rgb(inside,[136,12,19]);rgb(outside,[17,24,39]);expect(harness.otherRequests).toEqual([]);
});
test('replay truncation and copy or FIFO deletion remove stale pixels and preserve the correct final box',async({page,harness})=>{
 for(const action of['a.delete()','box.new(20,115,30,85,border_color=na,bgcolor=#0000ff80)']){const source=program(zone+'\nif bar_index==20\n    '+action).replace('overlay=true','overlay=true,max_boxes_count=1');const before=await run(page,source,{},bars.slice(0,20));expect(before.boxes).toHaveLength(1);rgb(await sample(page,17,100),[136,12,19]);const after=await run(page,source,{},bars.slice(0,21));expect(after.boxes.length).toBe(action==='a.delete()'?0:1);rgb(await sample(page,17,100),[17,24,39]);if(after.boxes.length)rgb(await sample(page,25,100),[8,12,147]);}
 expect(harness.otherRequests).toEqual([]);
});
test('persistent genuine worker restores prior box payloads and helper-only GC after conditional provisional ticks',async({page,harness})=>{
 const candle=(i,close)=>({time:bars[0].time+i*60,open:close,high:close+1,low:close-1,close,volume:20}),snapshot=Array.from({length:8},(_,i)=>candle(i,100)),base='var box a=box.new(1,110,6,90,border_color=na,bgcolor=#ff000080)';
 for(const action of['a.set_bgcolor(#0000ff80)','a.set_top(120)','a.set_text("Provisional")','a.delete()','box.new(1,120,6,80,border_color=na,bgcolor=#0000ff80)']){const source=program(base+'\nif barstate.isrealtime and close>105\n    '+action).replace('overlay=true','overlay=true,max_boxes_count=1');const initial=await page.evaluate(input=>window.pineBoxesFixture.startLive(input.source,input.snapshot,{from:0,to:10}),{source,snapshot});expect(initial.boxes).toHaveLength(1);rgb(await sample(page,4,100),[136,12,19]);const changed=await page.evaluate(input=>window.pineBoxesFixture.updateLive(input.bar,false),{bar:candle(8,110)});expect(changed.boxes).not.toEqual(initial.boxes);const restored=await page.evaluate(input=>window.pineBoxesFixture.updateLive(input.bar,false),{bar:candle(8,95)});expect(restored.boxes).toEqual(initial.boxes);rgb(await sample(page,4,100),[136,12,19]);await page.evaluate(()=>window.pineBoxesFixture.dispose());}
 expect(harness.workerRequests).toHaveLength(5);expect(harness.otherRequests).toEqual([]);
});
test('native dashed and dotted box borders produce real distinct ink runs across resize at both pixel densities',async({page,harness})=>{
 for(const style of['dashed','dotted']){const result=await run(page,program('var box a=box.new(12,110,33,90,border_color=#ff0000,bgcolor=na,border_width=2,border_style=line.style_'+style+')'));expect(result.boxes[0].borderStyle).toBe(style);for(const resize of[false,true]){if(resize)await page.evaluate(()=>window.pineBoxesFixture.resize());const scan=await page.evaluate(()=>window.pineBoxesFixture.scan(110,{from:14,to:31,radius:1}));expect(scan.samples).toBeGreaterThan(100);expect(scan.painted).toBeGreaterThan(scan.samples*.1);expect(scan.painted).toBeLessThan(scan.samples*.9);expect(scan.runs.length).toBeGreaterThan(3);expect(scan.gaps.some(n=>n>=2)).toBe(true);}}
 expect(harness.otherRequests).toEqual([]);
});
test('empty text-only charts seed scale for genuine nowrap overflow from offscreen boxes and keep auto-wrapped offscreen text hidden',async({page,harness})=>{
 for(const[left,right,align]of[[0,4,'left'],[42,46,'right']]){
  const body='var box a=box.new('+left+',110,'+right+',90,border_color=na,bgcolor=na,text='+JSON.stringify('Demand '.repeat(40))+',text_color=#00ff00,text_size=24,text_halign=text.align_'+align+',text_wrap=text.wrap_none)';
  const result=await run(page,program(body),{lineOnly:true,from:10,to:35});expect(result.placements[0].drawingRange.priceRange).toEqual({minValue:90,maxValue:110});expect((await glyphs(page,12,33,110,90)).ink).toBeGreaterThan(20);
  const wrapped=await run(page,program(body.replace('text.wrap_none','text.wrap_auto')),{lineOnly:true,from:10,to:35});expect(wrapped.placements[0].drawingRange).toBe(null);expect((await glyphs(page,12,33,110,90)).ink).toBe(0);
 }
 expect(harness.otherRequests).toEqual([]);
});
