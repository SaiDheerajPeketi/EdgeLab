import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

declare global { interface Window { pineForceOverlayFixture: any; } }
const root = path.resolve(import.meta.dirname, ".."), bytes = fs.readFileSync(path.join(root, "e2e/pine-visuals.bars.json")), bars = JSON.parse(bytes.toString());
const program = (body: string, overlay = true, front = false) => '//@version=6\nindicator("Force overlay 125",overlay=' + overlay + (front ? ',behind_chart=false' : '') + ')\n' + body;
type Harness = { origin: string; workerRequests: string[]; otherRequests: string[] };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
    const assets = path.join(root, "frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Build and freeze the production worker before this suite.");
    const workerPath = "/assets/" + workerName;
    const bundled = await build({ entryPoints: [path.join(root, "e2e/pine-force-overlay125.fixture.ts")], bundle: true, write: false, platform: "browser", format: "iife", globalName: "pineForceOverlayFixture",
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "force-overlay125" }));
        builder.onLoad({ filter: /.*/, namespace: "force-overlay125" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
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
    await new Promise<void>(resolve => server.listen(45225, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:45225", workerRequests, otherRequests }); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => { serverHarness.workerRequests.length = 0; serverHarness.otherRequests.length = 0; await page.goto(serverHarness.origin); await use(serverHarness); }
});
async function run(page, source, options = {}, snapshot = bars) {
  const result = await page.evaluate(input => window.pineForceOverlayFixture.run(input.source, input.snapshot, input.options), { source, snapshot, options });
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0); return result;
}
const snapshot=bars.map(b=>({...b,open:100,high:102,low:98,close:101}));
const shapes={
 line:forced=>'var line a=line.new(12,100.5,30,100.5,color=#ff0000,width=7,force_overlay='+forced+')',
 box:forced=>'var box a=box.new(12,101,30,100,border_color=na,bgcolor=#ff0000,force_overlay='+forced+')',
 label:forced=>'var label a=label.new(20,100.5,"",color=#ff0000,textcolor=na,size=18,style=label.style_label_center,force_overlay='+forced+')',
};
const key={line:'lines',box:'boxes',label:'labels'};
async function at(page,logical=20,price=100.5){return page.evaluate(input=>window.pineForceOverlayFixture.sample(input.logical,input.price),{logical,price});}
function exact(pixel,expected){expect(pixel.rgba).toEqual([...expected,255]);}
function script(body,overlay=true,behind=true){return '//@version=6\nindicator("Force overlay 125",overlay='+overlay+',behind_chart='+behind+')\n'+body;}
for(const kind of Object.keys(shapes))test('native '+kind+' defaults behind candles while force_overlay paints the same object above candles',async({page,harness})=>{
 for(const forced of[false,true]){const result=await run(page,script(shapes[kind](forced)),{candles:true},snapshot);expect(result[key[kind]]).toHaveLength(1);expect(result[key[kind]][0].forceOverlay).toBe(forced);expect(result[key[kind]][0].overlay).toBe(true);expect(result.placements).toHaveLength(1);exact(await at(page),forced?[255,0,0]:[71,85,105]);}
 expect(harness.otherRequests).toEqual([]);
});
test('mixed regular and forced objects preserve local front ownership instead of promoting every object in one host',async({page,harness})=>{
 for(const[regular,forced]of[['line','box'],['box','line'],['label','line'],['line','label'],['box','label'],['label','box']]){
  const body=shapes[forced](true).replace('var '+forced+' a=','var '+forced+' front=').replace('#ff0000','#0000ff')+'\n'+shapes[regular](false);const result=await run(page,script(body),{candles:true},snapshot);expect(result[key[regular]][0].forceOverlay).toBe(false);expect(result[key[forced]][0].forceOverlay).toBe(true);expect(result.placements).toHaveLength(1);exact(await at(page),[0,0,255]);
 }
 expect(harness.otherRequests).toEqual([]);
});
test('native overlay and behind_chart declarations combine independently with each forced object placement',async({page,harness})=>{
 for(const kind of Object.keys(shapes)){
  const separate=await run(page,script(shapes[kind](false)+'\n'+shapes[kind](true).replace(' a=',' forced='),false),{candles:true},snapshot);expect(separate[key[kind]].map(d=>[d.overlay,d.forceOverlay])).toEqual([[false,false],[true,true]]);expect(separate.placements).toHaveLength(2);exact(await at(page),[255,0,0]);
  const front=await run(page,script(shapes[kind](false),true,false),{candles:true},snapshot);expect(front[key[kind]][0].forceOverlay).toBe(false);exact(await at(page),[255,0,0]);
 }
 expect(harness.otherRequests).toEqual([]);
});
test('copied forced lines boxes and labels keep front ownership after native setters and replay deletion',async({page,harness})=>{
 for(const kind of Object.keys(shapes))for(const method of[false,true]){
  const copied='var '+kind+' b='+(method?'a.copy()':kind+'.copy(a)')+'\na.delete()';const result=await run(page,script(shapes[kind](true)+'\n'+copied),{candles:true},snapshot);expect(result[key[kind]]).toHaveLength(1);expect(result[key[kind]][0].forceOverlay).toBe(true);exact(await at(page),[255,0,0]);
  await run(page,script(shapes[kind](true)+'\na.delete()'),{candles:true},snapshot);exact(await at(page),[71,85,105]);
 }
 expect(harness.otherRequests).toEqual([]);
});
test('forced invisible strokes and backgrounds retain independent text ink without elevating ordinary peers',async({page,harness})=>{
 const line=await run(page,script(shapes.line(true).replace('color=#ff0000','color=na')+'\n'+shapes.box(false)),{candles:true},snapshot);expect(line.lines[0].color).toBe(null);exact(await at(page),[71,85,105]);
 for(const kind of['box','label']){const body=kind==='box'?'var box a=box.new(16,102,24,98,border_color=na,bgcolor=na,text="Demand",text_color=#00ff00,text_size=18,force_overlay=true)':'var label a=label.new(20,100.5,"Demand",color=na,textcolor=#00ff00,size=18,style=label.style_none,force_overlay=true)';const result=await run(page,script(body+'\n'+shapes.line(false)),{candles:true},snapshot);expect(result[key[kind]][0].forceOverlay).toBe(true);const glyphs=await page.evaluate(()=>window.pineForceOverlayFixture.glyphs(15,25,105,95));expect(glyphs.ink).toBeGreaterThan(20);}
 expect(harness.otherRequests).toEqual([]);
});
test('forced drawing phases preserve fill then line then box then label order and creation order within each kind',async({page,harness})=>{
 const line=shapes.line(true).replace(' a=',' guide=').replace('#ff0000','#0000ff'),box=shapes.box(true).replace(' a=',' zone='),label=shapes.label(true).replace(' a=',' tag=').replace('#ff0000','#00ff00');
 await run(page,script(line+'\n'+box),{candles:true},snapshot);exact(await at(page),[255,0,0]);await run(page,script(label+'\n'+box+'\n'+line),{candles:true},snapshot);exact(await at(page),[0,255,0]);
 for(const kind of Object.keys(shapes)){await run(page,script(shapes[kind](true)+'\n'+shapes[kind](true).replace(' a=',' later=').replace('#ff0000','#0000ff')),{candles:true},snapshot);exact(await at(page),[0,0,255]);}
 expect(harness.otherRequests).toEqual([]);
});
test('persistent genuine worker restores per-object front flags after provisional creation GC and copies on no-branch ticks',async({page,harness})=>{
 const candle=(i,close)=>({...snapshot[0],time:bars[0].time+i*60,close,high:Math.max(102,close+1),low:Math.min(98,close-1)}),history=Array.from({length:32},(_,i)=>candle(i,101));
 for(const kind of Object.keys(shapes)){
  const declaration=',max_'+({line:'lines',box:'boxes',label:'labels'}[kind])+'_count=1',body=shapes[kind](false)+'\nif barstate.isrealtime and close>105\n    '+shapes[kind](true).replace('var '+kind+' a=','');const source=script(body).replace('behind_chart=true','behind_chart=true'+declaration);
  const initial=await page.evaluate(input=>window.pineForceOverlayFixture.startLive(input.source,input.history,{candles:true,from:10,to:35}),{source,history});expect(initial[key[kind]][0].forceOverlay).toBe(false);exact(await at(page),[71,85,105]);
  const transient=await page.evaluate(input=>window.pineForceOverlayFixture.updateLive(input.bar,false),{bar:candle(32,110)});expect(transient[key[kind]][0].forceOverlay).toBe(true);exact(await at(page),[255,0,0]);
  const restored=await page.evaluate(input=>window.pineForceOverlayFixture.updateLive(input.bar,false),{bar:candle(32,101)});expect(restored[key[kind]]).toEqual(initial[key[kind]]);exact(await at(page),[71,85,105]);await page.evaluate(()=>window.pineForceOverlayFixture.dispose());
 }
 expect(harness.workerRequests).toHaveLength(3);expect(harness.otherRequests).toEqual([]);
});
test('line fills keep native boundary references and derive front phase from either forced boundary',async({page,harness})=>{
 for(const[one,two]of[[false,false],[true,false],[false,true],[true,true]]){const body='var line a=line.new(12,101,30,101,color=na,force_overlay='+one+')\nvar line b=line.new(12,100,30,100,color=na,force_overlay='+two+')\nvar linefill f=linefill.new(a,b,#ff0000)',result=await run(page,script(body),{candles:true},snapshot);expect(result.lines.find(l=>l.y1===101).forceOverlay).toBe(one);expect(result.lines.find(l=>l.y1===100).forceOverlay).toBe(two);expect(result.lineFills).toHaveLength(1);expect(result.lineFills[0].line1).toBe(result.lines.find(l=>l.y1===101).id);expect(result.lineFills[0].line2).toBe(result.lines.find(l=>l.y1===100).id);expect(result.placements).toHaveLength(1);exact(await at(page),one||two?[255,0,0]:[71,85,105]);if(one!==two)expect(result.warnings.some(w=>/mixed|boundary|layer/i.test(w))).toBe(true);}
 expect(harness.otherRequests).toEqual([]);
});
test('front labels own real pointer tooltips even when newer ordinary labels share the same host and anchor',async({page,harness})=>{
 const older='var label front=label.new(20,100.5,"",color=#0000ff,textcolor=na,size=24,style=label.style_circle,tooltip="Forced front",force_overlay=true)',newer='var label behind=label.new(20,100.5,"",color=#ff0000,textcolor=na,size=24,style=label.style_circle,tooltip="Ordinary behind")';
 await run(page,script(older+'\n'+newer),{candles:true},snapshot);const a=await page.evaluate(()=>window.pineForceOverlayFixture.anchor(20,100.5));await page.mouse.move(a.pageX,a.pageY);const tip=page.locator('[data-pine-label-tooltip]');await expect(tip).toBeVisible();await expect(tip).toHaveText('Forced front');exact(await at(page),[0,0,255]);
 await run(page,script(older.replace('tooltip="Forced front",','')+'\n'+newer),{candles:true},snapshot);const b=await page.evaluate(()=>window.pineForceOverlayFixture.anchor(20,100.5));await page.mouse.move(b.pageX+1,b.pageY);await expect(tip).toHaveCount(0);exact(await at(page),[0,0,255]);expect(harness.otherRequests).toEqual([]);
});
