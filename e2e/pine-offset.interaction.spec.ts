import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { test as base, expect, type Page } from "@playwright/test";

const bytes = fs.readFileSync(path.resolve("e2e/pine-visuals.bars.json"));
expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars = JSON.parse(bytes.toString()), artifacts = path.resolve(".artifacts/pine-offset41/browser");
// Only the real native worker, bridge, adapter and LWC participate in this harness.
const fixtureSource = String.raw`
import {createChart} from "../frontend/node_modules/lightweight-charts";
import {createPineRuntimeJob} from "../frontend/src/lib/pineRuntime";
import {adaptPineChartResult,installPineChartPlots} from "../frontend/src/lib/pineChartAdapter";
import {getPackedPinePlot,pointAtBar} from "../frontend/src/lib/pinePacked";
let state;
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
export async function run(input){
 if(state){state.installed.dispose();state.chart.remove();state=undefined;}const element=document.querySelector("#chart");element.replaceChildren();
 const result=await createPineRuntimeJob({action:"run",source:input.source,bars:input.bars,inputs:input.inputs??{},context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1},mode:"historical"}).promise;
 const adapted=adaptPineChartResult(result,input.bars),chart=createChart(element,{width:element.clientWidth,height:180,layout:{background:{color:"#111827"},textColor:"#cbd5e1"},grid:{vertLines:{visible:false},horzLines:{visible:false}},rightPriceScale:{borderVisible:false},timeScale:{visible:false},crosshair:{vertLine:{visible:false},horzLine:{visible:false}}});
 const base=chart.addLineSeries({color:"transparent",lineVisible:false,lastValueVisible:false,priceLineVisible:false,autoscaleInfoProvider:()=>input.bounds?{priceRange:{minValue:input.bounds[0],maxValue:input.bounds[1]}}:null});
 base.setData((input.chartBars??input.bars).map(bar=>({time:bar.time,value:100})));
 const installed=installPineChartPlots(chart,adapted.plots,"right",{scaleAnchor:(input.chartBars??input.bars).at(-1)});
 state={result,adapted,chart,element,installed,base,bars:input.bars,disposed:false};
 chart.timeScale().setVisibleLogicalRange({from:input.from??120,to:input.to??144});await paint();return summary();
}
export async function rejectSource(input){
 try{await run(input);return {status:"unexpected-completion"};}catch(error){return {status:"rejected",code:error.code,message:error.message};}
}
export function summary(){
 return {engine:state.result.audit.engineVersion,source:state.result.source,inputs:state.result.inputs,definitions:state.result.inputDefinitions,
 plots:state.result.plots.map(plot=>{const p=getPackedPinePlot(plot),buffers=p?[p.values.buffer,p.kinds.buffer,p.optionIndices.buffer]:[];return {id:plot.id,name:plot.name,style:plot.style,options:plot.options,packed:!!p,slots:p?.slots,bufferCount:new Set(buffers).size,bufferBytes:buffers.reduce((n,b)=>n+b.byteLength,0),
 samples:[0,115,120,125,126,128,130,131,255,10023,15023,state.bars.length-1].filter(i=>i<state.bars.length).map(i=>({index:i,point:p?pointAtBar(plot,i):plot.points.find(point=>point.time===state.bars[i].time)}))};}),
 drawn:state.adapted.plots.map(plot=>({id:plot.id,name:plot.name,kind:plot.kind})),warnings:state.adapted.adapterWarnings,
 geometry:{elementWidth:state.element.clientWidth,plotWidth:state.chart.paneSize().width,axisWidth:state.element.clientWidth-state.chart.paneSize().width,logicalAtLeft:state.chart.timeScale().coordinateToLogical(0),logicalAtRight:state.chart.timeScale().coordinateToLogical(state.chart.paneSize().width-1)},
 visible:state.chart.timeScale().getVisibleLogicalRange(),range:state.installed.primitive?.rangeForVisible(),stats:state.installed.primitive?.debugStats,series:state.installed.series.length};
}
function image(){
 const rect=state.element.getBoundingClientRect(),ratio=devicePixelRatio||1,canvas=document.createElement("canvas");canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);const ctx=canvas.getContext("2d");
 for(const layer of state.element.querySelectorAll("canvas")){const r=layer.getBoundingClientRect();ctx.drawImage(layer,(r.left-rect.left)*ratio,(r.top-rect.top)*ratio,r.width*ratio,r.height*ratio);}
 return {width:canvas.width,height:canvas.height,ratio,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data};
}
export function probe(time,price,offset=0,nextTime){
 const scale=state.chart.timeScale(),logical=scale.coordinateToLogical(scale.timeToCoordinate(time));
 let x=scale.logicalToCoordinate(logical+offset);if(nextTime!==undefined){const next=scale.coordinateToLogical(scale.timeToCoordinate(nextTime));x=(x+scale.logicalToCoordinate(next+offset))/2;}
 const host=state.disposed?state.base:state.installed.series[0]??state.base,y=host.priceToCoordinate(price),size=state.chart.paneSize();
 if(x===null||y===null||!Number.isFinite(x+y)||x<0||x>=size.width||y<0||y>=size.height)throw new Error("Probe outside actual chart "+JSON.stringify({logical,offset,x,y,size,visible:scale.getVisibleLogicalRange()}));
 const data=image(),cx=Math.round(x*data.ratio),cy=Math.round(y*data.ratio);let red=0,blue=0;
 for(let yy=Math.max(0,cy-2*data.ratio);yy<=Math.min(data.height-1,cy+2*data.ratio);yy++)for(let xx=Math.max(0,cx-2*data.ratio);xx<=Math.min(data.width-1,cx+2*data.ratio);xx++){const i=(yy*data.width+xx)*4,[r,g,b]=data.pixels.slice(i,i+3);if(r>120&&r>g*1.5&&r>b*1.5)red++;if(b>120&&b>r*1.5&&b>g*1.5)blue++;}
 const i=(cy*data.width+cx)*4;return {logical,shifted:logical+offset,x,y,width:size.width,height:size.height,dpr:data.ratio,red,blue,rgb:Array.from(data.pixels.slice(i,i+3))};
}
export async function pan(from,to){state.chart.timeScale().setVisibleLogicalRange({from,to});await paint();return summary();}
export async function resize(){state.chart.resize(state.element.clientWidth,128);await paint();return summary();}
export async function dispose(){state.installed.dispose();state.installed.dispose();state.disposed=true;await paint();return summary();}
`;
type Harness = { origin: string; workerRequests: string[]; otherRequests: string[]; workerSha256: string };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const assets = path.resolve("frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Root must freeze/build production first");
    const workerPath = "/assets/" + workerName, worker = fs.readFileSync(path.join(assets, workerName));
    const compiled = await build({ stdin: { contents: fixtureSource, resolveDir: path.resolve("e2e"), loader: "ts", sourcefile: "offset-proof.ts" }, bundle: true, write: false, platform: "browser", format: "iife", globalName: "offsetFixture",
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "actual-worker" }));
        builder.onLoad({ filter: /.*/, namespace: "actual-worker" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
      } }] });
    const workerRequests: string[] = [], otherRequests: string[] = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname; response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pine plot offsets</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}h1{font-size:20px}#chart{width:100%}</style><h1>Native Pine plot offsets · actual chart canvas</h1><div id="chart"></div><script src="/fixture.js"></script>'); }
      else if (pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(compiled.outputFiles[0].contents); }
      else if (pathname === workerPath) { workerRequests.push(pathname); response.setHeader("Content-Type", "text/javascript"); response.end(worker); }
      else if (pathname === "/favicon.ico") { response.statusCode = 204; response.end(); }
      else { otherRequests.push(pathname); response.statusCode = 404; response.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
    try { await use({ origin: "http://127.0.0.1:" + address.port, workerRequests, otherRequests, workerSha256: createHash("sha256").update(worker).digest("hex") }); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => {
    serverHarness.workerRequests.length = 0; serverHarness.otherRequests.length = 0;
    await page.goto(serverHarness.origin); await use(serverHarness);
  },
});
const program = (body: string) => '//@version=6\nindicator("Offset proof",overlay=false)\n' + body;
async function run(page: Page, source: string, options: any = {}) {
  const result = await page.evaluate(input => (window as any).offsetFixture.run(input), { source, bars, bounds: [80,120], ...options });
  expect(result.engine).toBe("0.11.0"); expect(result.source).toBe(source);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0); return result;
}
const probe = (page: Page, time: number, price: number, offset = 0, nextTime?: number) =>
  page.evaluate(input => (window as any).offsetFixture.probe(input.time, input.price, input.offset, input.nextTime), { time, price, offset, nextTime });
function rgb(actual: number[], expected: number[], label: string) {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i] - expected[i]), label + " RGB channel " + i).toBeLessThanOrEqual(2);
}
async function capture(page: Page, name: string, project: string, result: any, harness: Harness) {
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, name + "-" + project + ".png") });
  fs.writeFileSync(path.join(artifacts, name + "-" + project + ".json"), JSON.stringify({ workerSha256: harness.workerSha256, result }, null, 2));
}
const sample = (plot: any, index: number) => plot.samples.find((item: any) => item.index === index).point;

test("last show_last circle shifts into future and first circle into past whitespace", async ({ page, harness }, info) => {
  for (const [index, offset, from, to] of [[255,5,252,264],[0,-5,-9,3]]) {
    const source = program('plot(bar_index==' + index + '?100:na,title="Shifted circle",color=#ff0000,linewidth=4,style=plot.style_circles,offset=' + offset + ',show_last=' + (offset > 0 ? 1 : 256) + ')');
    const result = await run(page, source, { from, to });
    expect(result.warnings).toEqual([]); expect(result.drawn).toHaveLength(1);
    const raw = sample(result.plots[0], index); expect(raw.value).toBe(100); expect(raw.time).toBe(bars[index].time); expect(raw.options.offset).toBe(offset);
    const moved = await probe(page, bars[index].time,100,offset), original = await probe(page,bars[index].time,100);
    expect(moved.shifted).toBe(index + offset); rgb(moved.rgb,[255,0,0],"shifted circle"); expect(original.red).toBe(0);
    await capture(page,offset > 0 ? "future-circle" : "past-circle",info.project.name,{...result,moved,original},harness);
  }
  expect(harness.workerRequests).toHaveLength(2); expect(harness.otherRequests).toEqual([]);
});

test("all five supported scalar styles paint shifted slots without moving raw values or timestamps", async ({ page, harness }, info) => {
  for (const style of ["line","linebr","stepline","steplinebr","circles"]) {
    const source = program('plot(bar_index==130 or bar_index==131?100:na,title="' + style + '",color=#ff0000,linewidth=4,style=plot.style_' + style + ',offset=4)');
    const result = await run(page,source,{from:128,to:139}); expect(result.drawn).toHaveLength(1); expect(result.warnings).toEqual([]);
    for (const index of [130,131]) { const raw = sample(result.plots[0],index); expect(raw.value).toBe(100); expect(raw.time).toBe(bars[index].time); }
    const moved = await probe(page,bars[130].time,100,4,style === "circles" ? undefined : bars[131].time);
    expect(moved.red,style + " actual shifted path").toBeGreaterThan(0);
    expect((await probe(page,bars[130].time,100)).red,style + " old slot stays empty").toBe(0);
    await capture(page,"style-" + style,info.project.name,{...result,moved},harness);
  }
  expect(harness.workerRequests).toHaveLength(5); expect(harness.otherRequests).toEqual([]);
});

test("positional and named input offsets rerun while retaining original source and full optional metadata", async ({ page, harness }, info) => {
  const source = program('shift=input.int(3,"Shift")\nplot(bar_index==255?95:na,"Positional",#ff0000,4,plot.style_circles,false,0,shift,false,false,1,display.all)\nplot(bar_index==255?105:na,title="Named",color=#0000ff,linewidth=4,style=plot.style_circles,trackprice=false,histbase=0,offset=shift,join=false,editable=false,show_last=1,display=display.all)');
  for (const offset of [3,-3,0]) {
    const result = await run(page,source,{inputs:{in_0:offset},from:246,to:262}); expect(result.inputs.in_0).toBe(offset);
    expect(result.definitions.find((input:any) => input.title === "Shift").defval).toBe(3);
    const positional = result.plots.find((plot:any) => plot.name === "Positional"), named = result.plots.find((plot:any) => plot.name === "Named");
    for (const plot of [positional,named]) {
      expect(plot.options.offset).toBe(offset); expect(plot.options.show_last).toBe(1); expect(plot.options.editable).toBe(false); expect(plot.options.join).toBe(false);
      expect(sample(plot,255).time).toBe(bars[255].time);
    }
    expect(positional.options.display).toBeDefined(); expect(positional.options.display).toBe(named.options.display);
    expect(sample(positional,255).value).toBe(95); expect(sample(named,255).value).toBe(105);
    rgb((await probe(page,bars[255].time,95,offset)).rgb,[255,0,0],"positional input offset");
    rgb((await probe(page,bars[255].time,105,offset)).rgb,[0,0,255],"named input offset");
    await capture(page,"input-offset-" + offset,info.project.name,result,harness);
  }
  expect(harness.workerRequests).toHaveLength(3); expect(harness.otherRequests).toEqual([]);
});

test("sparse snapshots shift in the actual foreign chart timeline rather than snapshot ordinals", async ({ page, harness }, info) => {
  const prefix = Array.from({length:20},(_,i) => ({...bars[0],time:bars[0].time-(20-i)*60}));
  const chartBars = [...prefix,...bars.flatMap((bar:any) => [bar,{...bar,time:bar.time+1},{...bar,time:bar.time+2}])];
  const source = program('plot(bar_index==128?100:na,title="Sparse source",style=plot.style_circles,color=#ff0000,linewidth=4,offset=2)');
  const result = await run(page,source,{chartBars,from:398,to:412});
  const actual = await probe(page,bars[128].time,100,2), target = await probe(page,chartBars[406].time,100);
  expect(actual.logical).toBe(404); expect(actual.shifted).toBe(406); expect(actual.x).toBe(target.x);
  rgb(actual.rgb,[255,0,0],"foreign timeline shifted circle"); expect((await probe(page,bars[128].time,100)).red).toBe(0);
  expect(sample(result.plots[0],128)).toMatchObject({time:bars[128].time,value:100});
  await capture(page,"foreign-timeline",info.project.name,{...result,actual},harness);
  expect(harness.workerRequests).toHaveLength(1); expect(harness.otherRequests).toEqual([]);
});

test("shifted visible ranges exclude offscreen circles and clip bridged null-gap boundary values", async ({ page, harness }, info) => {
  const circle = await run(page,program('plot(bar_index==120?1000000:bar_index==130?100:na,title="Outlier",style=plot.style_circles,color=#ff0000,linewidth=4,offset=5)'),{from:130,to:139,bounds:null});
  expect(circle.range.priceRange).toEqual({minValue:100,maxValue:100});
  expect((await probe(page,bars[130].time,100,5)).red).toBeGreaterThan(0);
  for (const style of ["line","linebr"]) {
    const source = program('plot(bar_index==115?1000000:bar_index==125?100:bar_index==126?110:na,title="Gap",style=plot.style_' + style + ',color=#ff0000,linewidth=3,offset=5)');
    const result = await run(page,source,{from:125,to:135,bounds:null});
    // LWC can narrow the requested mobile window when large price labels widen the axis.
    // Independently interpolate the known shifted endpoints (120,1e6) and (130,100)
    // at the actual window boundary, preserving the fixed125→500050 oracle when applicable.
    fs.mkdirSync(artifacts, {recursive:true});
    fs.writeFileSync(path.join(artifacts,"clipped-range-" + style + "-" + info.project.name + ".json"),JSON.stringify({workerSha256:harness.workerSha256,result},null,2));
    expect(result.visible.from,JSON.stringify(result.geometry)).toBeGreaterThanOrEqual(120);
    expect(result.visible.from,JSON.stringify(result.geometry)).toBeLessThan(130);
    expect(result.visible.to).toBeGreaterThan(131);
    const fraction = (result.visible.from - 120) / 10;
    const clippedLeft = 1000000 * (1 - fraction) + 100 * fraction;
    expect(result.range.priceRange.minValue).toBe(100);
    expect(result.range.priceRange.maxValue).toBeCloseTo(style === "line" ? Math.max(110,clippedLeft) : 110,6);
    const target = Math.ceil(result.visible.from);
    expect(target).toBeLessThan(130);
    const targetFraction = (target - 120) / 10, targetPrice = 1000000 * (1 - targetFraction) + 100 * targetFraction;
    const actual = style === "line" ? await probe(page,bars[target-5].time,targetPrice,5) : await probe(page,bars[125].time,105,5,bars[126].time);
    expect(actual.red,style + " actual clipped visible path").toBeGreaterThan(0);
    await capture(page,"clipped-range-" + style,info.project.name,{...result,actual},harness);
  }
  expect(harness.workerRequests).toHaveLength(3); expect(harness.otherRequests).toEqual([]);
});

test("unsupported numeric kinds and invalid offset qualifiers disclose omission instead of painting stale slots", async ({ page, harness }) => {
  for (const body of [
    'plot(100,title="Area",style=plot.style_area,offset=2)',
    'plot(100,title="Histogram",style=plot.style_histogram,offset=-2)',
    'plotshape(true,title="Shape",style=shape.circle,location=location.absolute,offset=2)',
  ]) {
    const result = await run(page,program(body));
    expect(result.drawn).toHaveLength(0); expect(result.warnings.join(" ")).toMatch(/offset/i);
  }
  for (const [offset,message] of [["1.5","Plot offset must resolve to a valid integer."],["na","Plot offset must resolve to a valid integer."],["bar_index","Plot offset must remain constant throughout the snapshot."]]) {
    const source = program('plot(100,title="Rejected offset",offset=' + offset + ')');
    const rejected = await page.evaluate(input => (window as any).offsetFixture.rejectSource(input), {source,bars,bounds:[80,120]});
    expect(rejected).toEqual({status:"rejected",code:"UNSUPPORTED_PLOT_OPTION",message});
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
    await expect(page.locator("#chart canvas")).toHaveCount(0);
  }
  const filled = await run(page,program('a=plot(90,"Lower",offset=2)\nb=plot(110,"Upper")\nfill(a,b,color=#ff0000,title="Unsupported shifted fill")'));
  expect(filled.drawn.some((plot:any) => plot.kind === "fill")).toBe(false);
  expect(filled.warnings.join(" ")).toMatch(/fill.*offset|offset.*fill/i);
  expect(harness.workerRequests).toHaveLength(7); expect(harness.otherRequests).toEqual([]);
});

test("20k packed scalar offsets stay lazy while panning resizing and disposing", async ({ page, harness }, info) => {
  const snapshot = Array.from({length:20000},(_,index) => ({...bars[0],time:bars[0].time+index*60}));
  const source = program('plot(100+bar_index%10,title="Packed circles",color=#ff0000,linewidth=4,style=plot.style_circles,offset=11)');
  const initial = await run(page,source,{bars:snapshot,from:10020,to:10044});
  expect(initial.plots[0]).toMatchObject({packed:true,slots:20000,bufferCount:3,bufferBytes:220000});
  expect(initial.stats.decodedSamples).toBeLessThan(80);
  expect(sample(initial.plots[0],10023)).toMatchObject({time:snapshot[10023].time,value:103});
  rgb((await probe(page,snapshot[10023].time,103,11)).rgb,[255,0,0],"packed initial offset");
  const panned = await page.evaluate(() => (window as any).offsetFixture.pan(15020,15044));
  expect(panned.stats.decodedSamples-initial.stats.decodedSamples).toBeLessThan(80); expect(panned.stats.cacheEntries).toBeLessThanOrEqual(8192);
  rgb((await probe(page,snapshot[15023].time,103,11)).rgb,[255,0,0],"packed panned offset");
  const resized = await page.evaluate(() => (window as any).offsetFixture.resize());
  expect(resized.stats.decodedSamples-panned.stats.decodedSamples).toBeLessThan(80);
  rgb((await probe(page,snapshot[15023].time,103,11)).rgb,[255,0,0],"packed resized offset");
  await capture(page,"packed20k",info.project.name,resized,harness);
  const disposed = await page.evaluate(() => (window as any).offsetFixture.dispose());
  expect(disposed.stats.cacheEntries).toBe(0); expect(disposed.range).toBeNull();
  expect((await probe(page,snapshot[15023].time,103,11)).red).toBe(0);
  expect(harness.workerRequests).toHaveLength(1); expect(harness.otherRequests).toEqual([]);
});
