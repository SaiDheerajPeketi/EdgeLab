import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

declare global { interface Window { pineLabelsFixture: any; } }
const root = path.resolve(import.meta.dirname, ".."), bytes = fs.readFileSync(path.join(root, "e2e/pine-visuals.bars.json")), bars = JSON.parse(bytes.toString());
const program = (body: string, overlay = true, front = false) => '//@version=6\nindicator("Labels 123",overlay=' + overlay + (front ? ',behind_chart=false' : '') + ')\n' + body;
type Harness = { origin: string; workerRequests: string[]; otherRequests: string[] };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
    const assets = path.join(root, "frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Build and freeze the production worker before this suite.");
    const workerPath = "/assets/" + workerName;
    const bundled = await build({ entryPoints: [path.join(root, "e2e/pine-labels124.fixture.ts")], bundle: true, write: false, platform: "browser", format: "iife", globalName: "pineLabelsFixture",
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "labels124" }));
        builder.onLoad({ filter: /.*/, namespace: "labels124" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
      } }] });
    const worker = fs.readFileSync(path.join(assets, workerName)), workerRequests = [], otherRequests = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pine labels</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}.chart{width:100%;margin-bottom:20px}</style><p id="status" role="status">Awaiting actual production worker</p><div id="main" class="chart"></div><div id="pane" class="chart" hidden></div><script src="/fixture.js"></script>'); }
      else if (pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0].contents); }
      else if (pathname === workerPath) { workerRequests.push(pathname); response.setHeader("Content-Type", "text/javascript"); response.end(worker); }
      else if (pathname === "/favicon.ico") { response.statusCode = 204; response.end(); }
      else { otherRequests.push(pathname); response.statusCode = 404; response.end(); }
    });
    await new Promise<void>(resolve => server.listen(45224, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:45224", workerRequests, otherRequests }); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => { serverHarness.workerRequests.length = 0; serverHarness.otherRequests.length = 0; await page.goto(serverHarness.origin); await use(serverHarness); }
});
async function run(page, source, options = {}, snapshot = bars) {
  const result = await page.evaluate(input => window.pineLabelsFixture.run(input.source, input.snapshot, input.options), { source, snapshot, options });
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0); return result;
}
const tag='var label a=label.new(20,100,"",color=#ff000080,textcolor=na,size=18,style=label.style_label_center)';
const styles=['label_down','label_up','label_left','label_right','label_lower_left','label_lower_right','label_upper_left','label_upper_right','label_center','circle','square','diamond','flag','arrowup','arrowdown','cross','xcross','triangleup','triangledown','none','text_outline'];
const anchor=(page,x,y,placement=0)=>page.evaluate(input=>window.pineLabelsFixture.anchor(input.x,input.y,input.placement),{x,y,placement});
const pixel=(page,x=20,y=100,dx=0,dy=0,placement=0)=>page.evaluate(input=>window.pineLabelsFixture.offsetPixel(input.x,input.y,input.dx,input.dy,input.placement),{x,y,dx,dy,placement});
const region=(page,x=20,y=100,left=-100,right=100,top=-100,bottom=100,options={})=>page.evaluate(input=>window.pineLabelsFixture.region(input.x,input.y,input.left,input.right,input.top,input.bottom,input.options),{x,y,left,right,top,bottom,options});
function rgb(actual,expected){for(let i=0;i<3;i++)expect(Math.abs(actual.rgba[i]-expected[i])).toBeLessThanOrEqual(2);}
async function hover(page,x,y,dx=0,dy=0){const a=await anchor(page,x,y);await page.mouse.move(a.pageX+dx,a.pageY+dy);}

test('v5/v6 label bodies retain authored alpha, position, no invented timeline and owned disposal',async({page,harness})=>{
 for(const version of[5,6]){const result=await run(page,program(tag).replace('//@version=6','//@version='+version));expect(result.labels).toHaveLength(1);expect(result.labels[0].x).toBe(20);rgb(await pixel(page),[136,12,19]);rgb(await pixel(page,20,100,60,0),[17,24,39]);}
 await page.evaluate(()=>window.pineLabelsFixture.dispose());rgb(await pixel(page),[17,24,39]);expect(harness.workerRequests.length).toBeGreaterThan(0);expect(harness.otherRequests).toEqual([]);
});
test('all21 native label styles paint honest real shapes or plain text instead of silent omissions',async({page,harness})=>{
 for(const style of styles){const result=await run(page,program('var label a=label.new(20,100,"Demand",color=#ff0000,textcolor=#00ff00,size=18,style=label.style_'+style+')'));expect(result.labels[0].style).toBe(style);expect((await region(page,20,100,-150,150,-150,150,{channel:'green'})).ink).toBeGreaterThan(10);const red=await region(page,20,100,-150,150,-150,150);if(style==='none')expect(red.ink).toBe(0);else expect(red.ink).toBeGreaterThan(0);}
 expect(harness.otherRequests).toEqual([]);
});
test('NA and transparent shape or glyph colors stay independent and NA text keeps its background visible',async({page,harness})=>{
 for(const color of['na','color(na)','#ff000000']){const result=await run(page,program('var label a=label.new(20,100,"Demand",color='+color+',textcolor=#00ff00,size=18,style=label.style_label_center)'));expect(result.labels).toHaveLength(1);expect((await region(page,20,100,-100,100,-40,40,{channel:'green'})).ink).toBeGreaterThan(20);expect((await region(page)).ink).toBe(0);}
 for(const method of['a.set_text(na)','label.set_text(a,na)']){await run(page,program(tag.replace('"",','"Demand",')+'\n'+method));rgb(await pixel(page),[136,12,19]);}
 await run(page,program('var label a=label.new(20,100,"Hidden",color=na,textcolor=na)'));expect((await region(page)).ink).toBe(0);expect((await region(page,20,100,-100,100,-100,100,{channel:'green'})).ink).toBe(0);expect(harness.otherRequests).toEqual([]);
});
test('multiline text size alignment formatting and family use actual canvas glyphs and stable native metadata',async({page,harness})=>{
 const body=(align,size)=>'var label a=label.new(20,100,"Demand\\nZ",color=na,textcolor=#00ff00,size='+size+',textalign=text.align_'+align+',text_font_family=font.family_monospace,text_formatting=text.format_bold+text.format_italic,style=label.style_label_center)';
 let small,large;for(const size of[12,24]){const result=await run(page,program(body('center',size)));expect(result.labels[0].textSize).toBe(size);expect(result.labels[0].textFormatting).toBe('bolditalic');const glyph=await region(page,20,100,-150,150,-100,100,{channel:'green'});expect(glyph.ink).toBeGreaterThan(20);if(size===12)small=glyph;else large=glyph;}expect(large.maxY-large.minY).toBeGreaterThan(small.maxY-small.minY);expect(large.maxX-large.minX).toBeGreaterThan(small.maxX-small.minX);
 for(const align of['left','center','right']){await run(page,program(body(align,18)));expect((await region(page,20,100,-150,150,-100,100,{channel:'green'})).ink).toBeGreaterThan(20);}
 expect(harness.otherRequests).toEqual([]);
});
test('above and below labels ignore NA y and reference actual candle extremes even on inverted logarithmic scales',async({page,harness})=>{
 const snapshot=bars.map((b,i)=>({...b,open:100,high:102+i/10,low:98-i/10,close:100}));
 for(const yloc of['abovebar','belowbar']){const result=await run(page,program('var label a=label.new(20,na,"",color=#ff0000,textcolor=na,size=18,yloc=yloc.'+yloc+',style=label.style_label_center)'),{},snapshot);expect(result.labels[0].y).toBe(null);for(const invert of[false,true]){await page.evaluate(input=>window.pineLabelsFixture.scale(1,input.invert),{invert});const high=await anchor(page,20,snapshot[20].high),low=await anchor(page,20,snapshot[20].low),expectedY=yloc==='abovebar'?Math.min(high.y,low.y)-12:Math.max(high.y,low.y)+12;rgb(await pixel(page,20,snapshot[20].high,0,expectedY-high.y),[255,0,0]);}}
 const missingIndex=bars.length+5,missing=await run(page,program('var label a=label.new('+missingIndex+',na,"Missing",color=#ff0000,yloc=yloc.abovebar)'),{from:bars.length-1,to:bars.length+15});expect(missing.labels).toHaveLength(1);expect(missing.warnings.some(w=>/anchor|history/i.test(w))).toBe(true);expect((await region(page,missingIndex,100,-100,100,-150,150)).ink).toBe(0);expect(harness.otherRequests).toEqual([]);
});
test('bar-time labels interpolate genuine candle slots and shared timeline indices without fabricating relative missing anchors',async({page,harness})=>{
 const timed=await run(page,program('var label a=label.new(time+20*60000+30000,100,"",xloc=xloc.bar_time,color=#ff0000,textcolor=na,style=label.style_label_center)'));expect(timed.labels[0].x).toBe(bars[0].time+20*60+30);rgb(await pixel(page,20.5),[255,0,0]);
 await run(page,program('var label a=label.new(time+20*60000+30000,na,"Missing",xloc=xloc.bar_time,yloc=yloc.abovebar,color=#ff0000,textcolor=na)'));expect((await region(page,20.5)).ink).toBe(0);
 const chartBars=bars.flatMap((bar,i)=>i===bars.length-1?[bar]:[bar,{...bar,time:bar.time+30}]);await run(page,program(tag),{chartBars,from:25,to:55});rgb(await pixel(page,40),[136,12,19]);expect(harness.otherRequests).toEqual([]);
});
test('forced overlay and text-only empty panes preserve authored placement and exact scale anchors',async({page,harness})=>{
 const forced=await run(page,program(tag.replace('style=label.style_label_center','style=label.style_label_center,force_overlay=true'),false));expect(forced.labels[0].overlay).toBe(true);rgb(await pixel(page),[136,12,19]);
 const body='var label a=label.new(20,100,"Demand",color=na,textcolor=#00ff00,size=18,style=label.style_none)',separate=await run(page,program(body,false),{lineOnly:true});expect(separate.placements).toHaveLength(2);expect(separate.placements[1].drawingRange.priceRange).toEqual({minValue:100,maxValue:100});expect((await region(page,20,100,-150,150,-150,150,{placement:1,channel:'green'})).ink).toBeGreaterThan(20);
 const overflow=await run(page,program('var label a=label.new(0,100,'+JSON.stringify('Demand '.repeat(35))+',color=na,textcolor=#00ff00,size=18,style=label.style_label_left)'),{lineOnly:true,from:10,to:35});expect(overflow.placements[0].drawingRange.priceRange).toEqual({minValue:100,maxValue:100});expect((await region(page,20,100,-150,150,-100,100,{channel:'green'})).ink).toBeGreaterThan(20);expect(harness.otherRequests).toEqual([]);
});
test('genuine tooltip hover follows painted circle hit area, plain text, occlusion, pan and owned cleanup',async({page,harness})=>{
 const source=program('var label a=label.new(20,100,"",color=#ff0000,textcolor=na,size=24,style=label.style_circle,tooltip="Demand <b>plain</b>\\nVerified")');await run(page,source);const tooltip=page.locator('[data-pine-label-tooltip]');await hover(page,20,100);await expect(tooltip).toBeVisible();await expect(tooltip).toHaveText('Demand <b>plain</b>\nVerified');await expect(tooltip.locator('b')).toHaveCount(0);rgb(await pixel(page,20,100,11,20),[17,24,39]);await hover(page,20,100,11,20);await expect(tooltip).toBeHidden();
 await hover(page,20,100);await expect(tooltip).toBeVisible();await page.evaluate(()=>window.pineLabelsFixture.pan(15,40));await expect(tooltip).toBeHidden();await hover(page,20,100);await expect(tooltip).toBeVisible();await page.evaluate(()=>window.pineLabelsFixture.resize());await expect(tooltip).toBeHidden();await hover(page,20,100);await expect(tooltip).toBeVisible();await page.evaluate(()=>window.pineLabelsFixture.dispose());await expect(tooltip).toHaveCount(0);
 await run(page,source+'\nvar label b=label.new(20,100,"",color=#0000ff,textcolor=na,size=24,style=label.style_circle)');await hover(page,20,100);await expect(tooltip).toHaveCount(0);expect(harness.otherRequests).toEqual([]);
});
test('replay deletion and FIFO GC remove stale shape and tooltip state while retaining native final snapshots',async({page,harness})=>{
 for(const action of['a.delete()','label.new(27,100,"",color=#0000ff,textcolor=na,style=label.style_label_center)']){const source=program(tag.replace('textcolor=na','textcolor=na,tooltip="Demand"')+'\nif bar_index==25\n    '+action).replace('overlay=true','overlay=true,max_labels_count=1');const before=await run(page,source,{},bars.slice(0,25));expect(before.labels).toHaveLength(1);await hover(page,20,100);await expect(page.locator('[data-pine-label-tooltip]')).toBeVisible();const after=await run(page,source,{},bars.slice(0,26));expect(after.labels.length).toBe(action==='a.delete()'?0:1);await expect(page.locator('[data-pine-label-tooltip]')).toHaveCount(0);rgb(await pixel(page),[17,24,39]);if(after.labels.length)rgb(await pixel(page,27),[0,0,255]);}
 expect(harness.otherRequests).toEqual([]);
});
test('persistent genuine worker restores provisional label text style deletion and FIFO roots on no-branch ticks',async({page,harness})=>{
 const candle=(i,close)=>({time:bars[0].time+i*60,open:close,high:close+1,low:close-1,close,volume:20}),snapshot=Array.from({length:8},(_,i)=>candle(i,100)),base='var label a=label.new(4,100,"",color=#ff000080,textcolor=na,size=18,style=label.style_label_center)';
 for(const action of['a.set_color(#0000ff80)','a.set_text("Transient")','a.set_style(label.style_circle)','a.delete()','label.new(5,110,"New",color=#0000ff80)']){const source=program(base+'\nif barstate.isrealtime and close>105\n    '+action).replace('overlay=true','overlay=true,max_labels_count=1');const initial=await page.evaluate(input=>window.pineLabelsFixture.startLive(input.source,input.snapshot,{from:0,to:10}),{source,snapshot});rgb(await pixel(page,4),[136,12,19]);const changed=await page.evaluate(input=>window.pineLabelsFixture.updateLive(input.bar,false),{bar:candle(8,110)});expect(changed.labels).not.toEqual(initial.labels);const restored=await page.evaluate(input=>window.pineLabelsFixture.updateLive(input.bar,false),{bar:candle(8,95)});expect(restored.labels).toEqual(initial.labels);rgb(await pixel(page,4),[136,12,19]);await page.evaluate(()=>window.pineLabelsFixture.dispose());}
 expect(harness.workerRequests).toHaveLength(5);expect(harness.otherRequests).toEqual([]);
});
test('label shapes paint after boxes and survive pan resize with logarithmic or inverted price anchors',async({page,harness})=>{
 const body='var box zone=box.new(12,120,33,80,border_color=na,bgcolor=#0000ff)\nvar label a=label.new(20,100,"",color=#ff0000,textcolor=na,size=18,style=label.style_label_center)';await run(page,program(body),{bounds:[10,200]});for(const invert of[false,true]){await page.evaluate(input=>window.pineLabelsFixture.scale(1,input.invert),{invert});rgb(await pixel(page),[255,0,0]);rgb(await pixel(page,20,100,50,0),[0,0,255]);}await page.evaluate(()=>window.pineLabelsFixture.pan(15,40));await page.evaluate(()=>window.pineLabelsFixture.resize());rgb(await pixel(page),[255,0,0]);expect(harness.otherRequests).toEqual([]);
});
test('tooltip positions stay chart-local with a real left axis and page scroll and hide after price transform changes',async({page,harness})=>{
 await run(page,program('var label a=label.new(20,100,"",color=#ff0000,textcolor=na,size=24,style=label.style_label_center,tooltip="Anchored locally")'),{leftAxis:true});const coordinates=await page.evaluate(()=>window.pineLabelsFixture.priceCoordinates([90,100,110]));expect(coordinates.leftWidth).toBeGreaterThan(0);
 await page.evaluate(()=>{document.querySelector('#main').style.marginTop='600px';document.body.style.minHeight='2000px';});await page.locator('#main').scrollIntoViewIfNeeded();await hover(page,20,100);const tooltip=page.locator('[data-pine-label-tooltip]');await expect(tooltip).toBeVisible();const tip=await tooltip.boundingBox(),chart=await page.locator('#main').boundingBox();expect(tip.x).toBeGreaterThanOrEqual(chart.x);expect(tip.y).toBeGreaterThanOrEqual(chart.y);expect(tip.x+tip.width).toBeLessThanOrEqual(chart.x+chart.width+1);expect(tip.y+tip.height).toBeLessThanOrEqual(chart.y+chart.height+1);
 await page.evaluate(()=>window.pineLabelsFixture.scale(1,true));await expect(tooltip).toBeHidden();await hover(page,20,100);await expect(tooltip).toBeVisible();await page.evaluate(()=>window.pineLabelsFixture.zoomPriceMargins(.25,.25));await expect(tooltip).toBeHidden();await hover(page,20,100);await expect(tooltip).toBeVisible();await page.evaluate(()=>window.pineLabelsFixture.dispose());await expect(tooltip).toHaveCount(0);expect(harness.otherRequests).toEqual([]);
});
test('huge and newline-heavy label metrics leave finite strictly monotonic price transforms in main and empty separate panes',async({page,harness})=>{
 for(const pane of[false,true])for(const text of['Huge','Demand\n'.repeat(100)]){
  const source=program('var label a=label.new(20,100,'+JSON.stringify(text)+',color=#ff0000,textcolor=#00ff00,size=512,style=label.style_label_center)',!pane),result=await run(page,source,pane?{lineOnly:true}:{}),placement=pane?1:0;expect(result.labels[0].textSize).toBe(512);
  for(const[mode,invert]of[[0,false],[0,true],[1,false],[1,true]]){await page.evaluate(input=>window.pineLabelsFixture.scale(input.mode,input.invert),{mode,invert});const view=await page.evaluate(input=>window.pineLabelsFixture.priceCoordinates([90,95,100,105,110],input.placement),{placement});expect(view.coordinates.every(Number.isFinite)).toBe(true);for(let i=1;i<view.coordinates.length;i++){if(invert)expect(view.coordinates[i]).toBeGreaterThan(view.coordinates[i-1]);else expect(view.coordinates[i]).toBeLessThan(view.coordinates[i-1]);}expect(view.pane.height).toBeGreaterThan(50);}
 }
 expect(harness.otherRequests).toEqual([]);
});
test('native force_overlay puts labels above candles while ordinary overlay labels retain behind_chart and one placement owner',async({page,harness})=>{
 const snapshot=bars.map((b,i)=>({...b,open:100,high:102,low:98,close:i===20?101:100})),body='var label a=label.new(20,100.5,"",color=#ff0000,textcolor=na,size=18,style=label.style_label_center)';
 const normal=await run(page,program(body),{candles:true},snapshot);expect(normal.labels[0].forceOverlay).toBe(false);rgb(await pixel(page,20,100.5),[71,85,105]);
 const forced=await run(page,program(body.replace('style=label.style_label_center','style=label.style_label_center,force_overlay=true')),{candles:true},snapshot);expect(forced.labels[0].forceOverlay).toBe(true);expect(forced.placements).toHaveLength(1);rgb(await pixel(page,20,100.5),[255,0,0]);
 const mixed=await run(page,program(body+'\nvar label b=label.new(20,100.5,"",color=#0000ff,textcolor=na,size=18,style=label.style_label_center,force_overlay=true)'),{candles:true},snapshot);expect(mixed.labels.map(l=>l.forceOverlay)).toEqual([false,true]);expect(mixed.placements).toHaveLength(1);rgb(await pixel(page,20,100.5),[0,0,255]);expect(harness.otherRequests).toEqual([]);
});
test('two genuine independent drawing owners with opposite huge labels preserve positive transforms under tight scale margins',async({page,harness})=>{
 const label=style=>program('var label a=label.new(20,100,"Huge",color=#ff0000,textcolor=#00ff00,size=512,style=label.style_'+style+')');await run(page,label('label_up'),{lineOnly:true});const second=await page.evaluate(source=>window.pineLabelsFixture.secondStudy(source),label('label_down'));expect(second.labels).toHaveLength(1);await page.evaluate(()=>window.pineLabelsFixture.zoomPriceMargins(.45,.45));
 for(const[mode,invert]of[[0,false],[0,true],[1,false],[1,true]]){await page.evaluate(input=>window.pineLabelsFixture.scale(input.mode,input.invert),{mode,invert});const state=await page.evaluate(()=>window.pineLabelsFixture.priceCoordinates([90,95,100,105,110]));expect(state.coordinates.every(Number.isFinite)).toBe(true);for(let i=1;i<state.coordinates.length;i++)if(invert)expect(state.coordinates[i]).toBeGreaterThan(state.coordinates[i-1]);else expect(state.coordinates[i]).toBeLessThan(state.coordinates[i-1]);}
 await page.evaluate(()=>window.pineLabelsFixture.dispose());expect(harness.otherRequests).toEqual([]);
});
