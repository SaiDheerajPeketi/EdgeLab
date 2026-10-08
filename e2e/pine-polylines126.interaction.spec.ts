import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

declare global { interface Window { pinePolylinesFixture: any; } }
const root = path.resolve(import.meta.dirname, ".."), bytes = fs.readFileSync(path.join(root, "e2e/pine-visuals.bars.json")), bars = JSON.parse(bytes.toString());
const program = (body: string, overlay = true, front = false) => '//@version=6\nindicator("Polylines 126",overlay=' + overlay + (front ? ',behind_chart=false' : '') + ')\n' + body;
type Harness = { origin: string; workerRequests: string[]; otherRequests: string[] };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
    const assets = path.join(root, "frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Build and freeze the production worker before this suite.");
    const workerPath = "/assets/" + workerName;
    const bundled = await build({ entryPoints: [path.join(root, "e2e/pine-polylines126.fixture.ts")], bundle: true, write: false, platform: "browser", format: "iife", globalName: "pinePolylinesFixture",
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "polylines126" }));
        builder.onLoad({ filter: /.*/, namespace: "polylines126" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
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
    await new Promise<void>(resolve => server.listen(45226, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:45226", workerRequests, otherRequests }); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => { serverHarness.workerRequests.length = 0; serverHarness.otherRequests.length = 0; await page.goto(serverHarness.origin); await use(serverHarness); }
});
async function run(page, source, options = {}, snapshot = bars) {
  const result = await page.evaluate(input => window.pinePolylinesFixture.run(input.source, input.snapshot, input.options), { source, snapshot, options });
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0); return result;
}
const script=(body,overlay=true,extra='')=>'//@version=6\nindicator("Polylines 126",overlay='+overlay+extra+')\n'+body;
const authored=[[12,90],[16,110],[20,110],[24,90]];
const declaration=(points=authored)=>'var points=array.from('+points.map(([x,y])=>'chart.point.from_index('+x+','+(y===null?'na':y)+')').join(',')+')';
const polylineSource=(options='',points=authored)=>declaration(points)+'\nvar polyline a=polyline.new(points'+(options?','+options:'')+')';
const pixel=(page,x,y)=>page.evaluate(input=>window.pinePolylinesFixture.sample(input.x,input.y),{x,y});
const red=rgba=>expect(rgba[0]).toBeGreaterThan(230);
const blank=rgba=>expect(rgba).toEqual([17,24,39,255]);
async function screen(page,points){return page.evaluate(input=>input.map(([x,y])=>window.pinePolylinesFixture.anchor(x,y)),points);}
// Independent cubic Bernstein evaluation from authored Catmull–Rom neighbor tangents.
function spline(p0,p1,p2,p3,t){const one=1-t,c1={x:p1.x+(p2.x-p0.x)/6,y:p1.y+(p2.y-p0.y)/6},c2={x:p2.x-(p3.x-p1.x)/6,y:p2.y-(p3.y-p1.y)/6};return{x:one**3*p1.x+3*one**2*t*c1.x+3*one*t**2*c2.x+t**3*p2.x,y:one**3*p1.y+3*one**2*t*c1.y+3*one*t**2*c2.y+t**3*p2.y};}
async function projected(page,base,point){return page.evaluate(input=>window.pinePolylinesFixture.offsetPixel(input.base[0],input.base[1],input.point.x-input.anchor.x,input.point.y-input.anchor.y),{base,point,anchor:(await screen(page,[base]))[0]});}

test('straight open segments use exact authored geometry while closed adds only the authored final seam and independent fill',async({page,harness})=>{
 const triangle=[[12,90],[20,110],[28,90]];
 for(const closed of[false,true]){const result=await run(page,script(polylineSource('closed='+closed+',line_color=#0000ff,fill_color=#00ff00,line_width=5',triangle)));expect(result.polylines[0].closed).toBe(closed);expect(result.polylines[0].points).toEqual(triangle.map(([x,y])=>({x,y})));const inside=await pixel(page,20,100);expect(inside.rgba).toEqual([0,255,0,255]);const seam=await pixel(page,20,90);if(closed)expect(seam.rgba).toEqual([0,0,255,255]);else expect(seam.rgba[2]).toBeLessThan(100);expect((await pixel(page,15,105)).rgba).toEqual([17,24,39,255]);}
 expect(harness.otherRequests).toEqual([]);
});
test('curved paths interpolate independent cubic screen coordinates instead of connecting static straight mountains',async({page,harness})=>{
 const points=[[12,90],[16,110],[20,100],[24,95]];
 for(const[mode,invert]of[[0,false],[1,false],[1,true]]){await run(page,script(polylineSource('curved=true,line_color=#ff0000,line_width=5',points)));await page.evaluate(input=>window.pinePolylinesFixture.scale(input.mode,input.invert),{mode,invert});const anchors=await screen(page,points),expected=spline(...anchors,.5),paint=await projected(page,points[1],expected);red(paint.rgba);expect(paint.rgba[1]).toBeLessThan(30);expect(paint.rgba[2]).toBeLessThan(30);await page.evaluate(()=>window.pinePolylinesFixture.pan(15,22));await page.evaluate(()=>window.pinePolylinesFixture.resize());await page.evaluate(()=>window.pinePolylinesFixture.zoomPriceMargins(.25,.25));red((await projected(page,points[1],spline(...await screen(page,points),.5))).rgba);await run(page,script(polylineSource('curved=false,line_color=#ff0000,line_width=3',points)));await page.evaluate(input=>window.pinePolylinesFixture.scale(input.mode,input.invert),{mode,invert});blank((await projected(page,points[1],spline(...await screen(page,points),.5))).rgba);}
 expect(harness.otherRequests).toEqual([]);
});
test('closed curved paths use cyclic neighbors and paint their smooth final seam with nonzero-winding filled interior',async({page,harness})=>{
 const points=[[12,90],[16,110],[24,105],[28,90]];await run(page,script(polylineSource('curved=true,closed=true,line_color=#ff0000,fill_color=#00ff00,line_width=5',points)));const anchors=await screen(page,points),expected=spline(anchors[2],anchors[3],anchors[0],anchors[1],.5);red((await projected(page,points[3],expected)).rgba);expect((await pixel(page,20,100)).rgba).toEqual([0,255,0,255]);expect(harness.otherRequests).toEqual([]);
});
test('true curve overshoots seed an empty pane scale and cropped view extrema include the interior derivative root',async({page,harness})=>{
 let result=await run(page,script(polylineSource('curved=true,line_color=#ff0000,line_width=3')),{lineOnly:true});expect(result.placements[0].drawingRange.priceRange.minValue).toBeCloseTo(90,8);expect(result.placements[0].drawingRange.priceRange.maxValue).toBeCloseTo(112.5,8);red((await pixel(page,18,112.5)).rgba);
 result=await page.evaluate(()=>window.pinePolylinesFixture.pan(17,19));const range=result.placements[0].drawingRange.priceRange,viewport=result.placements[0].visible,price=x=>110+10*((x-16)/4)*(1-(x-16)/4);expect(viewport.from).toBeGreaterThan(16);expect(viewport.to).toBeLessThan(20);expect(range.minValue).toBeCloseTo(Math.min(price(viewport.from),price(viewport.to)),8);expect(range.maxValue).toBeCloseTo(112.5,8);red((await pixel(page,18,112.5)).rgba);expect(harness.otherRequests).toEqual([]);
});
test('NA point coordinates split valid runs without inventing bridges closing seams or polygon fill',async({page,harness})=>{
 const points=[[12,90],[16,110],[20,null],[24,90],[28,110]],result=await run(page,script(polylineSource('curved=true,closed=true,line_color=#ff0000,fill_color=#00ff00,line_width=5',points)));expect(result.polylines[0].points[2]).toEqual({x:20,y:null});red((await pixel(page,14,100)).rgba);red((await pixel(page,26,100)).rgba);blank((await pixel(page,20,100)).rgba);blank((await pixel(page,20,90)).rgba);expect(harness.otherRequests).toEqual([]);
});
test('NA stroke fill and degenerate paths preserve authored objects and paint only independent positive-area ink',async({page,harness})=>{
 await run(page,script(polylineSource('line_color=na,fill_color=#00ff00')));expect((await pixel(page,18,100)).rgba).toEqual([0,255,0,255]);await run(page,script(polylineSource('line_color=#ff0000,fill_color=na,line_width=3')));blank((await pixel(page,18,100)).rgba);red((await pixel(page,18,110)).rgba);
 for(const points of[[],[[20,100]],[[20,100],[20,100]]]){const body=points.length?polylineSource('line_color=#ff0000,fill_color=#00ff00',points):'var points=array.new<chart.point>()\nvar polyline a=polyline.new(points,line_color=#ff0000,fill_color=#00ff00)',result=await run(page,script(body));expect(result.polylines).toHaveLength(1);expect(result.polylines[0].points).toHaveLength(points.length);blank((await pixel(page,20,100)).rgba);}
 expect(harness.otherRequests).toEqual([]);
});
test('time and shared timeline geometry map actual loaded candles and interpolate fractional timestamp positions',async({page,harness})=>{
 const timed='var points=array.from(chart.point.from_time(time+12*60000,90),chart.point.from_time(time+28*60000,110))\nvar polyline a=polyline.new(points,xloc=xloc.bar_time,line_color=#ff0000,line_width=5)',result=await run(page,script(timed));expect(result.polylines[0].points[0].x).toBe(bars[0].time+12*60);red((await pixel(page,20,100)).rgba);
 const chartBars=bars.flatMap((b,i)=>i===bars.length-1?[b]:[b,{...b,time:b.time+30}]);await run(page,script(polylineSource('line_color=#ff0000,line_width=5',[[12,90],[28,110]])),{chartBars,from:20,to:65});red((await pixel(page,40,100)).rgba);expect(harness.otherRequests).toEqual([]);
});
test('polyline forced flags own main-chart front ink independently of behind-chart peers and separate indicator panes',async({page,harness})=>{
 const candles=bars.map(b=>({...b,open:100,high:102,low:98,close:101})),points=[[12,100.5],[30,100.5]];
 for(const forced of[false,true]){const result=await run(page,script(polylineSource('line_color=#ff0000,line_width=7,force_overlay='+forced,points)),{candles:true},candles);expect(result.polylines[0].forceOverlay).toBe(forced);expect((await pixel(page,20,100.5)).rgba).toEqual(forced?[255,0,0,255]:[71,85,105,255]);}
 const body=polylineSource('line_color=#0000ff,line_width=7',points)+'\nvar polyline forced=polyline.new(points,line_color=#ff0000,line_width=7,force_overlay=true)',result=await run(page,script(body,false),{candles:true},candles);expect(result.polylines.map(p=>[p.overlay,p.forceOverlay])).toEqual([[false,false],[true,true]]);expect(result.placements).toHaveLength(2);expect((await pixel(page,20,100.5)).rgba).toEqual([255,0,0,255]);expect(harness.otherRequests).toEqual([]);
});
test('polyline native drawing group paints above boxes below labels and retains newest polyline creation order',async({page,harness})=>{
 const polygon=[[12,110],[28,110],[28,90],[12,90]],green=polylineSource('closed=true,line_color=na,fill_color=#00ff00,force_overlay=true',polygon),box='var box b=box.new(12,110,28,90,bgcolor=#0000ff,border_color=na,force_overlay=true)',label='var label l=label.new(20,100,"",color=#ff0000,textcolor=na,style=label.style_label_center,force_overlay=true)';
 await run(page,script(green+'\n'+box));expect((await pixel(page,20,100)).rgba).toEqual([0,255,0,255]);await run(page,script(label+'\n'+green+'\n'+box));expect((await pixel(page,20,100)).rgba).toEqual([255,0,0,255]);await run(page,script(green+'\nvar polyline newer=polyline.new(points,closed=true,line_color=na,fill_color=#0000ff,force_overlay=true)'));expect((await pixel(page,20,100)).rgba).toEqual([0,0,255,255]);expect(harness.otherRequests).toEqual([]);
});
test('all native six stroke styles retain visible genuine chart ink and dash or arrow behavior through pan resize',async({page,harness})=>{
 for(const style of['solid','dashed','dotted','arrow_left','arrow_right','arrow_both']){const result=await run(page,script(polylineSource('line_color=#ff0000,line_width=3,line_style=line.style_'+style,[[12,100],[28,100]])));expect(result.polylines[0].lineStyle).toBe(style);const scan=await page.evaluate(()=>window.pinePolylinesFixture.scan(100,{from:13,to:27,radius:1}));expect(scan.ink).toBeGreaterThan(20);if(['dashed','dotted'].includes(style))expect(scan.gaps.length).toBeGreaterThan(1);await page.evaluate(()=>window.pinePolylinesFixture.pan(14,30));await page.evaluate(()=>window.pinePolylinesFixture.resize());expect((await page.evaluate(()=>window.pinePolylinesFixture.scan(100,{from:15,to:27,radius:1}))).ink).toBeGreaterThan(20);}
 expect(harness.otherRequests).toEqual([]);
});
test('native ten-thousand-point open path remains complete through worker transport chart paint and disposal',async({page,harness})=>{
 const body='var points=array.new<chart.point>()\nif barstate.isfirst\n    for i=0 to 9999\n        array.push(points,chart.point.from_index(12+i%17,100+i%5/5))\n    polyline.new(points,line_color=#ff0000,line_width=3)',result=await run(page,script(body));expect(result.polylines[0].points).toHaveLength(10000);expect(result.polylines[0].points.at(-1)).toEqual({x:12+9999%17,y:100+9999%5/5});expect((await page.evaluate(()=>window.pinePolylinesFixture.scan(100.4,{from:14,to:26,radius:3}))).ink).toBeGreaterThan(20);await page.evaluate(()=>window.pinePolylinesFixture.dispose());blank((await pixel(page,20,100.4)).rgba);expect(harness.otherRequests).toEqual([]);
});
test('persistent native delete and FIFO replacement restores helper roots and exact prior pixels on no-branch live ticks',async({page,harness})=>{
 const candle=(i,close)=>({time:bars[0].time+i*60,open:100,high:Math.max(102,close+2),low:Math.min(98,close-2),close,volume:20}),history=Array.from({length:32},(_,i)=>candle(i,100)),points=[[12,100],[28,100]];
 for(const action of['a.delete()','polyline.new(points,line_color=#0000ff,line_width=5)']){const source=script(polylineSource('line_color=#ff0000,line_width=5',points)+'\nif barstate.isrealtime and close>105\n    '+action,true,',max_polylines_count=1'),initial=await page.evaluate(input=>window.pinePolylinesFixture.startLive(input.source,input.history),{source,history});red((await pixel(page,20,100)).rgba);const transient=await page.evaluate(input=>window.pinePolylinesFixture.updateLive(input.bar,false),{bar:candle(32,110)});expect(transient.polylines).not.toEqual(initial.polylines);const restored=await page.evaluate(input=>window.pinePolylinesFixture.updateLive(input.bar,false),{bar:candle(32,95)});expect(restored.polylines).toEqual(initial.polylines);red((await pixel(page,20,100)).rgba);await page.evaluate(()=>window.pinePolylinesFixture.dispose());blank((await pixel(page,20,100)).rgba);}
 expect(harness.workerRequests).toHaveLength(2);expect(harness.otherRequests).toEqual([]);
});
test('typed NA point array slots survive native snapshots and preserve distinct stroke runs without a phantom fill',async({page,harness})=>{
 const body='var array<chart.point> points=array.from(chart.point.from_index(12,90),chart.point.from_index(16,110),na,chart.point.from_index(24,90),chart.point.from_index(28,110))\nvar polyline a=polyline.new(points,closed=true,curved=true,line_color=#ff0000,line_width=5,fill_color=#00ff00)',result=await run(page,script(body));expect(result.polylines[0].points[2]).toEqual({x:null,y:null});red((await pixel(page,14,100)).rgba);red((await pixel(page,26,100)).rgba);blank((await pixel(page,20,100)).rgba);expect(harness.otherRequests).toEqual([]);
});
test('closed polyline fill uses nonzero winding when the authored path traverses the same rectangle twice',async({page,harness})=>{
 const points=[[12,110],[28,110],[28,90],[12,90],[12,110],[28,110],[28,90],[12,90]];await run(page,script(polylineSource('closed=true,line_color=na,fill_color=#00ff00',points)));expect((await pixel(page,20,100)).rgba).toEqual([0,255,0,255]);expect(harness.otherRequests).toEqual([]);
});
test('repeated authored endpoints still draw arrow wings while closed paths and clipped pane edges never invent arrow tips',async({page,harness})=>{
 const points=[[12,100],[12,100],[20,100],[28,100],[28,100]];
 // Repeated curved endpoints have zero first derivative; the first distinct Bézier control points backwards.
 for(const curved of[false,true]){await run(page,script(polylineSource('curved='+curved+',line_color=#ff0000,line_width=5,line_style=line.style_arrow_both',points)));const direction=curved?-1:1;const left=await page.evaluate(dx=>window.pinePolylinesFixture.offsetPixel(12,100,dx,5),10*direction),right=await page.evaluate(dx=>window.pinePolylinesFixture.offsetPixel(28,100,dx,5),-10*direction);red(left.rgba);red(right.rgba);await page.evaluate(()=>window.pinePolylinesFixture.pan(15,25));const edge=await page.evaluate(()=>{const a=window.pinePolylinesFixture.anchor(20,100);return window.pinePolylinesFixture.offsetPixel(20,100,10-a.x,5);});blank(edge.rgba);}
 await run(page,script(polylineSource('closed=true,line_color=#ff0000,line_width=5,line_style=line.style_arrow_both',points)));blank((await page.evaluate(()=>window.pinePolylinesFixture.offsetPixel(12,100,10,5))).rgba);expect(harness.otherRequests).toEqual([]);
});
