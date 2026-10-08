import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

declare global { interface Window { pineLinesFixture: any; } }
const root = path.resolve(import.meta.dirname, ".."), bytes = fs.readFileSync(path.join(root, "e2e/pine-visuals.bars.json")), bars = JSON.parse(bytes.toString());
const program = (body: string, overlay = true, front = false) => '//@version=6\nindicator("Line drawings 121",overlay=' + overlay + (front ? ',behind_chart=false' : '') + ')\n' + body;
type Harness = { origin: string; workerRequests: string[]; otherRequests: string[] };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
    const assets = path.join(root, "frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Build and freeze the production worker before this suite.");
    const workerPath = "/assets/" + workerName;
    const bundled = await build({ entryPoints: [path.join(root, "e2e/pine-lines121.fixture.ts")], bundle: true, write: false, platform: "browser", format: "iife", globalName: "pineLinesFixture",
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "lines121" }));
        builder.onLoad({ filter: /.*/, namespace: "lines121" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
      } }] });
    const worker = fs.readFileSync(path.join(assets, workerName)), workerRequests = [], otherRequests = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pine line drawings</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}.chart{width:100%;margin-bottom:20px}</style><p id="status" role="status">Awaiting actual production worker</p><div id="main" class="chart"></div><div id="pane" class="chart" hidden></div><script src="/fixture.js"></script>'); }
      else if (pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0].contents); }
      else if (pathname === workerPath) { workerRequests.push(pathname); response.setHeader("Content-Type", "text/javascript"); response.end(worker); }
      else if (pathname === "/favicon.ico") { response.statusCode = 204; response.end(); }
      else { otherRequests.push(pathname); response.statusCode = 404; response.end(); }
    });
    await new Promise<void>(resolve => server.listen(45221, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:45221", workerRequests, otherRequests }); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => { serverHarness.workerRequests.length = 0; serverHarness.otherRequests.length = 0; await page.goto(serverHarness.origin); await use(serverHarness); }
});
async function run(page, source, options = {}, snapshot = bars) {
  const result = await page.evaluate(input => window.pineLinesFixture.run(input.source, input.snapshot, input.options), { source, snapshot, options });
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0); return result;
}
const scan = (page, price = 100, options = {}) => page.evaluate(input => window.pineLinesFixture.scan(input.price, input.options), { price, options });
function patterned(frame) {
  expect(frame.samples).toBeGreaterThan(150);
  expect(frame.painted).toBeGreaterThan(frame.samples * .1);
  expect(frame.painted).toBeLessThan(frame.samples * .9);
  expect(frame.runs.length).toBeGreaterThan(3);
  expect(frame.gaps.some(n => n >= 2)).toBe(true);
}
function solid(frame) { expect(frame.painted).toBeGreaterThan(frame.samples * .96); expect(frame.runs.length).toBeLessThanOrEqual(2); }

const spot = (page,logical,price,options={}) => page.evaluate(input=>window.pineLinesFixture.spot(input.logical,input.price,input.options),{logical,price,options});
const horizontal = (price=100,style="solid",extend="none",from=12,to=33,extra="") => `var line a=line.new(${from},${price},${to},${price},color=#ff0000,width=3,style=line.style_${style},extend=extend.${extend}${extra})`;

test("actual production worker transports v5/v6 final setter and copy snapshots into independent real chart pixels",async({page,harness})=>{
  for(const version of [5,6]) {
    const body=horizontal(90)+ '\nif bar_index==2\n    a.set_y1(100)\n    a.set_y2(100)\n    b=line.copy(a)\n    b.set_y1(110)\n    b.set_y2(110)\n    b.set_color(#0000ff)';
    const result=await run(page,program(body).replace('//@version=6','//@version='+version));
    expect(result.lines.map(l=>[l.x1,l.y1,l.x2,l.y2,l.color])).toEqual([[12,100,33,100,"#ff0000"],[12,110,33,110,"#0000ff"]]);
    expect((await scan(page,90,{from:14,to:31,radius:1})).painted).toBe(0);
    solid(await scan(page,100,{from:14,to:31,radius:1})); solid(await scan(page,110,{from:14,to:31,channel:"blue",radius:1}));
    expect(result.warnings.some(w=>/UNSUPPORTED_DRAWING/.test(w))).toBe(false);
  }
  expect(harness.workerRequests.length).toBeGreaterThan(0);expect(harness.otherRequests).toEqual([]);
});
test("solid dash dot and arrow styles preserve visible distinctions after pan zoom resize and disposal",async({page,harness},info)=>{
  for(const style of ["solid","dashed","dotted"]) {
    await run(page,program(horizontal(100,style,"both")));
    const frame=await scan(page,100,{from:12,to:33,radius:1}); if(style==="solid")solid(frame);else patterned(frame);
    await page.evaluate(()=>window.pineLinesFixture.pan(45,70));
    const pan=await scan(page,100,{from:47,to:68,radius:1}); if(style==="solid")solid(pan);else patterned(pan);
    await page.evaluate(()=>window.pineLinesFixture.resize());
    const resize=await scan(page,100,{from:47,to:68,radius:1});if(style==="solid")solid(resize);else patterned(resize);
  }
  for(const [style,left,right]of [["solid",false,false],["arrow_left",true,false],["arrow_right",false,true],["arrow_both",true,true]]) {
    await run(page,program(horizontal(100,style)));
    const a=await spot(page,12,100,{radius:12}),b=await spot(page,33,100,{radius:12});
    if(style==="solid") { (page as any).__lineInk=[a.ink,b.ink]; }
    else { const base=(page as any).__lineInk;expect(a.ink>base[0]+4).toBe(left);expect(b.ink>base[1]+4).toBe(right); }
  }
  await page.screenshot({path:path.join(root,".artifacts","pine-lines121-"+info.project.name+".png"),fullPage:true});
  await page.evaluate(()=>window.pineLinesFixture.dispose());expect((await scan(page,100,{from:12,to:33,radius:12})).painted).toBe(0);expect(harness.otherRequests).toEqual([]);
});
test("extensions obey authored directions and reversed lines; future whitespace has no fabricated candles",async({page,harness})=>{
  for(const [extend,left,right] of [["none",false,false],["left",true,false],["right",false,true],["both",true,true]]) {
    await run(page,program(horizontal(100,"solid",extend,17,27)));
    expect((await spot(page,14,100)).ink>0).toBe(left);expect((await spot(page,30,100)).ink>0).toBe(right);expect((await spot(page,22,100)).ink).toBeGreaterThan(0);
  }
  await run(page,program(horizontal(100,"solid","right",27,17)));
  expect((await spot(page,14,100)).ink).toBe(0);expect((await spot(page,30,100)).ink).toBeGreaterThan(0);
  const result=await run(page,program(horizontal(100,"solid","none",30,45)),{from:25,to:50},bars.slice(0,36));
  expect(result.lines.map(l=>[l.x1,l.x2])).toEqual([[30,45]]);expect((await spot(page,42,100)).ink).toBeGreaterThan(0);expect(harness.otherRequests).toEqual([]);
});
test("millisecond bar-time lines interpolate sparse actual chart gaps while force_overlay respects study placement",async({page,harness})=>{
  const t=bars[0].time,snapshot=Array.from({length:8},(_,i)=>({...bars[i],time:t+[0,60,120,600,660,720,780,840][i]}));
  const bt=`var line a=line.new(${(t+360)*1000},90,${(t+630)*1000},110,xloc=xloc.bar_time,color=#ff0000,width=3)`;
  const result=await run(page,program(bt),{from:0,to:7},snapshot);
  expect(result.lines[0].xloc).toBe("bar_time");expect(result.lines[0].x1).toBe(t+360);expect(result.lines[0].x2).toBe(t+630);
  expect((await spot(page,2.5,90)).ink).toBeGreaterThan(0);expect((await spot(page,3.5,110)).ink).toBeGreaterThan(0);
  const placements=await run(page,program(horizontal(90)+ '\n'+horizontal(110,"solid","none",12,33,',force_overlay=true').replace('var line a=','var line b=').replace('color=#ff0000','color=#0000ff'),false));
  expect(placements.lines.map(l=>l.overlay)).toEqual([false,true]);expect(placements.placements).toHaveLength(2);
  expect((await scan(page,90,{placement:0,radius:1})).painted).toBe(0);expect((await scan(page,90,{placement:1,radius:1})).painted).toBeGreaterThan(0);
  expect((await scan(page,110,{placement:0,channel:"blue",radius:1})).painted).toBeGreaterThan(0);expect((await scan(page,110,{placement:1,channel:"blue",radius:1})).painted).toBe(0);expect(harness.otherRequests).toEqual([]);
});
test("replay deletion and bounded oldest-line eviction remove actual prior ink without changing numeric plots",async({page,harness})=>{
  const body=horizontal(100)+ '\nif bar_index==20\n    line.delete(a)\nplot(90,"Numeric",color=#0000ff)';
  await run(page,program(body),{},bars.slice(0,20));expect((await spot(page,17,100)).ink).toBeGreaterThan(0);
  const deleted=await run(page,program(body),{},bars.slice(0,21));expect(deleted.lines).toEqual([]);expect((await spot(page,17,100)).ink).toBe(0);expect((await scan(page,90,{channel:"blue",from:12,to:18,radius:1})).painted).toBeGreaterThan(0);
  const bounded=await run(page,program('line.new(bar_index,100,bar_index+1,100,color=#ff0000,width=3)').replace('overlay=true','overlay=true,max_lines_count=3'),{from:12,to:36},bars.slice(0,36));
  expect(bounded.lines.map(l=>l.x1)).toEqual([33,34,35]);expect((await spot(page,17,100)).ink).toBe(0);expect((await spot(page,34,100)).ink).toBeGreaterThan(0);expect(harness.otherRequests).toEqual([]);
});
test("persistent production worker replaces provisional line drawings, rolls setters back and commits exactly one newborn per bar",async({page,harness})=>{
  const candle=(i,close)=>({time:bars[0].time+i*60,open:close,high:close+1,low:close-1,close,volume:20}),snapshot=Array.from({length:8},(_,i)=>candle(i,100));
  const source=program('var line a=line.new(1,90,6,100,color=#ff0000,width=3)\na.set_y1(close)\na.set_y2(close)\nif barstate.isrealtime\n    line.new(bar_index,close,bar_index+1,close,color=#0000ff,width=3)');
  let result=await page.evaluate(input=>window.pineLinesFixture.startLive(input.source,input.snapshot,{from:0,to:10}),{source,snapshot});expect(result.lines).toHaveLength(1);
  for(const [close,confirmed] of [[110,false],[90,false],[105,true]]) {
    result=await page.evaluate(input=>window.pineLinesFixture.updateLive(input.candle,input.confirmed),{candle:candle(8,close),confirmed});
    expect(result.lines).toHaveLength(2);expect(result.lines[0].y2).toBe(close);expect(result.lines[1].y1).toBe(close);
    expect((await spot(page,4,close)).ink).toBeGreaterThan(0);expect((await spot(page,8.5,close,{channel:"blue"})).ink).toBeGreaterThan(0);
    if(close!==110) expect((await spot(page,4,110)).ink).toBe(0);
  }
  result=await page.evaluate(input=>window.pineLinesFixture.updateLive(input.candle,false),{candle:candle(9,115)});expect(result.lines).toHaveLength(3);expect(result.lines.slice(1).map(l=>l.y1)).toEqual([105,115]);
  expect((await spot(page,8.5,105,{channel:"blue"})).ink).toBeGreaterThan(0);expect((await spot(page,9.5,115,{channel:"blue"})).ink).toBeGreaterThan(0);
  expect(harness.workerRequests).toHaveLength(1);expect(harness.otherRequests).toEqual([]);expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(1);
  await page.evaluate(()=>window.pineLinesFixture.dispose());expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0);
});

test("a later realtime tick restores existing-line setters and deletion even when its branch does not run",async({page,harness})=>{
  const candle=(i,close)=>({time:bars[0].time+i*60,open:close,high:close+1,low:close-1,close,volume:20}),snapshot=Array.from({length:8},(_,i)=>candle(i,100));
  for(const mode of ["setters","delete"]) {
    const source=program(horizontal(100,"solid","none",1,6)+'\nif barstate.isrealtime and close>105\n'+(mode==="delete"?'    a.delete()':'    a.set_y1(110)\n    a.set_y2(110)\n    a.set_color(#0000ff)'));
    const initial=await page.evaluate(input=>window.pineLinesFixture.startLive(input.source,input.snapshot,{from:0,to:10}),{source,snapshot});expect(initial.lines).toHaveLength(1);
    const provisional=await page.evaluate(input=>window.pineLinesFixture.updateLive(input.bar,false),{bar:candle(8,110)});
    if(mode==="delete")expect(provisional.lines).toEqual([]);else expect((await spot(page,4,110,{channel:"blue"})).ink).toBeGreaterThan(0);
    expect((await spot(page,4,100)).ink).toBe(0);
    const restored=await page.evaluate(input=>window.pineLinesFixture.updateLive(input.bar,false),{bar:candle(8,95)});
    expect(restored.lines).toEqual(initial.lines);expect((await spot(page,4,100)).ink).toBeGreaterThan(0);expect((await spot(page,4,110,{channel:"blue"})).ink).toBe(0);
    await page.evaluate(()=>window.pineLinesFixture.dispose());
  }
  expect(harness.workerRequests).toHaveLength(2);expect(harness.otherRequests).toEqual([]);
});

test("shared timeline indexes and genuine logarithmic inverted scales retain authored line geometry",async({page,harness})=>{
  const snapshot=bars.slice(0,40),timeline=snapshot.flatMap(b=>[b,{...b,time:b.time+30}]);
  await run(page,program(horizontal(100)),{from:20,to:72,chartBars:timeline},snapshot);
  expect((await spot(page,24,100)).ink).toBeGreaterThan(0);expect((await spot(page,66,100)).ink).toBeGreaterThan(0);expect((await spot(page,21,100)).ink).toBe(0);
  await run(page,program('line.new(12,20,33,200,color=#ff0000,width=3)'),{bounds:[10,300]});
  for(const invert of [false,true]) {
    await page.evaluate(input=>window.pineLinesFixture.scale(1,input.invert),{invert});
    expect((await spot(page,12,20,{radius:3})).ink).toBeGreaterThan(0);expect((await spot(page,33,200,{radius:3})).ink).toBeGreaterThan(0);
    expect((await spot(page,22.5,Math.sqrt(20*200),{radius:3})).ink).toBeGreaterThan(0);
    expect((await spot(page,22.5,110,{radius:3})).ink).toBe(0);
  }
  expect(harness.otherRequests).toEqual([]);
});
test("helper-only committed drawings restore after a provisional newborn evicts their active set",async({page,harness})=>{
  const candle=(i,close)=>({time:bars[0].time+i*60,open:close,high:close+1,low:close-1,close,volume:20}),snapshot=Array.from({length:8},(_,i)=>candle(i,100));
  const source=program('if bar_index==0\n    line.new(1,100,6,100,color=#ff0000,width=3)\nif barstate.isrealtime and close>105\n    line.new(bar_index,110,bar_index+1,110,color=#0000ff,width=3)').replace('overlay=true','overlay=true,max_lines_count=1');
  const initial=await page.evaluate(input=>window.pineLinesFixture.startLive(input.source,input.snapshot,{from:0,to:10}),{source,snapshot});
  const evicted=await page.evaluate(input=>window.pineLinesFixture.updateLive(input.bar,false),{bar:candle(8,110)});expect(evicted.lines.map(l=>l.color)).toEqual(["#0000ff"]);expect((await spot(page,4,100)).ink).toBe(0);
  const restored=await page.evaluate(input=>window.pineLinesFixture.updateLive(input.bar,false),{bar:candle(8,95)});expect(restored.lines).toEqual(initial.lines);expect((await spot(page,4,100)).ink).toBeGreaterThan(0);expect((await spot(page,8.5,110,{channel:"blue"})).ink).toBe(0);
  await page.evaluate(()=>window.pineLinesFixture.dispose());expect(harness.workerRequests).toHaveLength(1);expect(harness.otherRequests).toEqual([]);
});

test("a real empty chart bootstraps line-only autoscale from authored prices without any fixed-range base series",async({page,harness})=>{
  const output=await run(page,program('line.new(2,90,8,110,color=#ff0000,width=3)'),{lineOnly:true,from:1,to:10},bars.slice(0,12));
  expect(output.placements).toHaveLength(1);expect(output.placements[0].range.priceRange.minValue).toBeCloseTo(90,8);expect(output.placements[0].range.priceRange.maxValue).toBeCloseTo(110,8);
  const a=await spot(page,3,90+20/6),b=await spot(page,7,90+100/6);expect(a.ink).toBeGreaterThan(0);expect(b.ink).toBeGreaterThan(0);
  expect(a.y).toBeGreaterThan(b.y);expect(b.y).toBeGreaterThan(0);
  expect(harness.workerRequests).toHaveLength(1);expect(harness.otherRequests).toEqual([]);
});

test("tiny authored prices bootstrap a real empty chart range without collapsing to zero",async({page,harness})=>{
  const output=await run(page,program('var line tiny=line.new(2,0.0000000001,8,0.0000000002,color=#ff0000,width=3)'),{lineOnly:true,from:1,to:10},bars.slice(0,12));
  expect(output.lines.map(l=>[l.y1,l.y2])).toEqual([[1e-10,2e-10]]);
  const range=output.placements[0].range.priceRange;expect(range.minValue).toBeGreaterThan(0);expect(Math.abs(range.minValue/1e-10-1)).toBeLessThan(1e-12);expect(Math.abs(range.maxValue/2e-10-1)).toBeLessThan(1e-12);
  expect(harness.workerRequests).toHaveLength(1);expect(harness.otherRequests).toEqual([]);
});
