import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { test as base, expect, type Page } from "@playwright/test";

const bytes = fs.readFileSync(path.resolve("e2e/pine-visuals.bars.json"));
expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars = JSON.parse(bytes.toString()), artifacts = path.resolve(".artifacts/pine-numeric42/browser");
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
export function summary(){
 return {engine:state.result.audit.engineVersion,source:state.result.source,inputs:state.result.inputs,definitions:state.result.inputDefinitions,
 plots:state.result.plots.map(plot=>{const p=getPackedPinePlot(plot),buffers=p?[p.values.buffer,p.kinds.buffer,p.optionIndices.buffer]:[];return {id:plot.id,name:plot.name,style:plot.style,options:plot.options,packed:!!p,slots:p?.slots,bufferCount:new Set(buffers).size,bufferBytes:buffers.reduce((n,b)=>n+b.byteLength,0),
 samples:[0,1,115,120,121,122,125,126,128,130,131,254,255,10023,15023,state.bars.length-1].filter(i=>i<state.bars.length).map(i=>({index:i,point:p?pointAtBar(plot,i):plot.points.find(point=>point.time===state.bars[i].time)}))};}),
 drawn:state.adapted.plots.map(plot=>({id:plot.id,name:plot.name,kind:plot.kind})),warnings:state.adapted.adapterWarnings,
 geometry:{elementWidth:state.element.clientWidth,plotWidth:state.chart.paneSize().width,axisWidth:state.element.clientWidth-state.chart.paneSize().width,logicalAtLeft:state.chart.timeScale().coordinateToLogical(0),logicalAtRight:state.chart.timeScale().coordinateToLogical(state.chart.paneSize().width-1)},
 visible:state.chart.timeScale().getVisibleLogicalRange(),range:state.installed.primitive?.rangeForVisible(),stats:state.installed.primitive?.debugStats,series:state.installed.series.length};
}
function image(){
 const rect=state.element.getBoundingClientRect(),ratio=devicePixelRatio||1,canvas=document.createElement("canvas");canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);const ctx=canvas.getContext("2d");
 for(const layer of state.element.querySelectorAll("canvas")){const r=layer.getBoundingClientRect();ctx.drawImage(layer,(r.left-rect.left)*ratio,(r.top-rect.top)*ratio,r.width*ratio,r.height*ratio);}
 return {width:canvas.width,height:canvas.height,ratio,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data};
}
export function probe(time,price,offset=0,nextTime,dx=0){
 const scale=state.chart.timeScale(),sourceX=scale.timeToCoordinate(time);if(sourceX===null)throw new Error("Source time missing from actual chart");const logical=scale.coordinateToLogical(sourceX);if(logical===null)throw new Error("Actual source logical coordinate unavailable");
 let x=scale.logicalToCoordinate(logical+offset);if(nextTime!==undefined){const next=scale.coordinateToLogical(scale.timeToCoordinate(nextTime));x=(x+scale.logicalToCoordinate(next+offset))/2;}
 if(x!==null)x+=dx;const host=state.disposed?state.base:state.installed.series[0]??state.base,y=host.priceToCoordinate(price),size=state.chart.paneSize();
 if(x===null||y===null||!Number.isFinite(x+y)||x<0||x>=size.width||y<0||y>=size.height)throw new Error("Probe outside actual chart "+JSON.stringify({logical,offset,x,y,size,visible:scale.getVisibleLogicalRange()}));
 const data=image(),cx=Math.round(x*data.ratio),cy=Math.round(y*data.ratio);let red=0,blue=0;
 for(let yy=Math.max(0,cy-2*data.ratio);yy<=Math.min(data.height-1,cy+2*data.ratio);yy++)for(let xx=Math.max(0,cx-2*data.ratio);xx<=Math.min(data.width-1,cx+2*data.ratio);xx++){const i=(yy*data.width+xx)*4,[r,g,b]=data.pixels.slice(i,i+3);if(r>120&&r>g*1.5&&r>b*1.5)red++;if(b>120&&b>r*1.5&&b>g*1.5)blue++;}
 const i=(cy*data.width+cx)*4;return {logical,shifted:logical+offset,x,y,width:size.width,height:size.height,dpr:data.ratio,red,blue,rgb:Array.from(data.pixels.slice(i,i+3))};
}
export function span(time,price,offset=0){
 const center=probe(time,price,offset),scale=state.chart.timeScale(),imageData=image(),row=Math.round(center.y*imageData.ratio),panePixels=Math.floor(state.chart.paneSize().width*imageData.ratio);let painted=0,left=Infinity,right=-Infinity;
 for(let x=0;x<panePixels;x++){const i=(row*imageData.width+x)*4,[r,g,b]=imageData.pixels.slice(i,i+3);if(r>120&&r>g*1.5&&r>b*1.5){painted++;left=Math.min(left,x);right=Math.max(right,x);}}
 return {width:painted/imageData.ratio,left:left/imageData.ratio,right:right/imageData.ratio,dpr:imageData.ratio,slotWidth:Math.abs(scale.logicalToCoordinate(center.shifted+1)-scale.logicalToCoordinate(center.shifted)),center};
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
    const compiled = await build({ stdin: { contents: fixtureSource, resolveDir: path.resolve("e2e"), loader: "ts", sourcefile: "numeric-proof.ts" }, bundle: true, write: false, platform: "browser", format: "iife", globalName: "numericFixture",
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "actual-worker" }));
        builder.onLoad({ filter: /.*/, namespace: "actual-worker" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
      } }] });
    const workerRequests: string[] = [], otherRequests: string[] = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname; response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pine numeric plots</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}h1{font-size:20px}#chart{width:100%}</style><h1>Native Pine numeric plots · actual chart canvas</h1><div id="chart"></div><script src="/fixture.js"></script>'); }
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
const program = (body: string) => '//@version=6\nindicator("Numeric proof",overlay=false)\n' + body;
async function run(page: Page, source: string, options: any = {}) {
  const result = await page.evaluate(input => (window as any).numericFixture.run(input), { source, bars, bounds: [80,120], ...options });
  expect(result.engine).toBe("0.11.0"); expect(result.source).toBe(source);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0); return result;
}
const probe = (page: Page, time: number, price: number, offset = 0, nextTime?: number, dx = 0) =>
  page.evaluate(input => (window as any).numericFixture.probe(input.time, input.price, input.offset, input.nextTime, input.dx), { time, price, offset, nextTime, dx });
const composite=(hex:string,under=[17,24,39])=>{const h=hex.slice(1),alpha=h.length===8?parseInt(h.slice(6),16)/255:1;return under.map((v,i)=>Math.round(parseInt(h.slice(i*2,i*2+2),16)*alpha+v*(1-alpha)));};
function rgb(actual: number[], expected: number[], label: string) {
  for (let i = 0; i < 3; i++) expect(Math.abs(actual[i] - expected[i]), label + " RGB channel " + i).toBeLessThanOrEqual(2);
}
async function capture(page: Page, name: string, project: string, result: any, harness: Harness) {
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, name + "-" + project + ".png") });
  fs.writeFileSync(path.join(artifacts, name + "-" + project + ".json"), JSON.stringify({ workerSha256: harness.workerSha256, result }, null, 2));
}
const sample = (plot: any, index: number) => plot.samples.find((item: any) => item.index === index).point;


test("histogram and two-point area geometry shifts into future and past whitespace", async ({ page, harness }, info) => {
  for (const style of ["histogram","area"]) for (const offset of [5,-5]) {
    const first = offset > 0 ? 254 : 0, last = first + 1;
    const source = program('plot(bar_index==' + first + ' or bar_index==' + last + '?100:na,title="Shifted ' + style + '",color=#ff0000,linewidth=4,style=plot.style_' + style + ',histbase=0,offset=' + offset + ',show_last=' + (offset > 0 ? 2 : 256) + ')');
    const result = await run(page,source,{from:offset>0?252:-9,to:offset>0?264:3,bounds:[-20,120]});
    expect(result.drawn).toHaveLength(1); expect(result.warnings).toEqual([]);
    const actual = await probe(page,bars[first].time,50,offset,style === "area" ? bars[last].time : undefined);
    rgb(actual.rgb,[255,0,0],"shifted " + style + " body"); expect(actual.shifted).toBe(first+offset);
    expect(sample(result.plots[0],first)).toMatchObject({time:bars[first].time,value:100});
    expect(result.plots[0].options.offset).toBe(offset); expect(result.plots[0].options.histbase).toBe(0);
    await capture(page,style + (offset>0?"-future":"-past"),info.project.name,{...result,actual},harness);
  }
  expect(harness.workerRequests).toHaveLength(4); expect(harness.otherRequests).toEqual([]);
});

test("named and positional input reruns retain independent shift baseline and color", async ({ page, harness }, info) => {
  for (const positional of [false,true]) {
    const source = program('shift=input.int(3,"Shift")\nbase=input.float(0,"Baseline")\nshade=input.color(#ff0000,"Shade")\n' +
      (positional ? 'plot(bar_index==130 or bar_index==131?100:na,"Input area",shade,2,plot.style_area,false,base,shift,false,false,126,display.all)'
      : 'plot(bar_index==130 or bar_index==131?100:na,title="Input area",color=shade,linewidth=2,style=plot.style_area,offset=shift,histbase=base,editable=false,show_last=126,display=display.all)'));
    for (const [shift,base,color] of [[3,0,"#ff0000"],[-3,40,"#0000ff"],[0,-20,"#ff000080"]] as const) {
      const result = await run(page,source,{from:124,to:139,bounds:[-40,140],inputs:{in_0:shift,in_1:base,in_2:color}});
      expect(result.stats).toBeDefined(); expect(result.series).toBe(1); expect(result.inputs).toEqual({in_0:shift,in_1:base,in_2:color}); expect(result.plots[0].options).toMatchObject({offset:shift,histbase:base,editable:false,show_last:126});
      expect(sample(result.plots[0],130)).toMatchObject({time:bars[130].time,value:100});
      const actual = await probe(page,bars[130].time,(base+100)/2,shift,bars[131].time);
      rgb(actual.rgb,composite(color),"independent baseline and color");
      await capture(page,(positional?"positional":"named") + "-input-" + shift,info.project.name,{...result,actual},harness);
    }
  }
  expect(harness.workerRequests).toHaveLength(6); expect(harness.otherRequests).toEqual([]);
});

test("histograms and columns paint values on both sides of a nonzero baseline", async ({ page, harness }, info) => {
  for (const style of ["histogram","columns"]) {
    const result = await run(page,program('plot(bar_index==130?120:bar_index==131?80:na,title="Both sides",color=#ff0000,linewidth=12,style=plot.style_' + style + ',histbase=100,offset=3)'),{from:125,to:141,bounds:[60,140]});
    expect(result.drawn).toHaveLength(1); expect(result.warnings.join(" ")).not.toMatch(/offset.*not|not.*offset|line width is limited/);
    for (const [index,inside,outside] of [[130,110,130],[131,90,70]]) {
      rgb((await probe(page,bars[index].time,inside,3)).rgb,[255,0,0],style + " baseline body");
      rgb((await probe(page,bars[index].time,outside,3)).rgb,[17,24,39],style + " outside body");
    }
    expect(result.plots[0].options.histbase).toBe(100);
    await capture(page,style+"-baseline-above-below",info.project.name,result,harness);
  }
  expect(harness.workerRequests).toHaveLength(2); expect(harness.otherRequests).toEqual([]);
});

test("area bridges raw na gaps while areabr leaves them empty and scales plotted values only", async ({ page, harness }, info) => {
  for (const style of ["area","areabr"]) {
    const result = await run(page,program('plot(bar_index==120 or bar_index==122?100:na,title="Gap",color=#ff000080,linewidth=2,style=plot.style_' + style + ',histbase=0,offset=2)'),{from:119,to:127,bounds:[-20,120]});
    expect(sample(result.plots[0],121).value).toBeNull();
    const actual = await probe(page,bars[121].time,50,2);
    rgb(actual.rgb,style === "area" ? composite("#ff000080") : [17,24,39],style+" raw-na gap");
    expect(result.range.priceRange).toEqual(style === "area" ? {minValue:0,maxValue:100} : {minValue:100,maxValue:100});
    await capture(page,style+"-na-gap",info.project.name,{...result,actual},harness);
  }
  expect(harness.workerRequests).toHaveLength(2); expect(harness.otherRequests).toEqual([]);
});

test("flat alpha areas keep exact color across heights and fractional DPR segment joins", async ({ page, harness }, info) => {
  for (const color of ["#ff000080","#ff000000","na"]) {
    const result = await run(page,program('plot(100,title="Alpha area",color=' + color + ',linewidth=2,style=plot.style_area,histbase=0,offset=2)'),{from:120.13,to:143.77,bounds:[-20,120]});
    const expected = color === "#ff000080" ? composite(color) : [17,24,39];
    for (const price of [20,50,80]) for (const dx of [-2,-1.5,-1,-.5,0,.5,1,1.5,2])
      rgb((await probe(page,bars[130].time,price,2,undefined,dx)).rgb,expected,"flat area alpha/seam");
    await capture(page,"flat-area-"+(color === "na" ? "na" : color.slice(1)),info.project.name,result,harness);
  }
  expect(harness.workerRequests).toHaveLength(3); expect(harness.otherRequests).toEqual([]);
});

test("histogram linewidth stays fixed in pixels while columns ignore it and follow logical spacing", async ({ page, harness }, info) => {
  for (const style of ["histogram","columns"]) {
    const measures = [];
    for (const width of (style === "histogram" ? [12] : [1,12])) for (const [from,to] of [[120,140],[127,133]]) {
      const result = await run(page,program('plot(bar_index==130?100:na,title="Width",color=#ff0000,linewidth='+width+',style=plot.style_'+style+',histbase=0,offset=0)'),{from,to,bounds:[-20,120]});
      expect(result.stats).toBeDefined(); expect(result.series).toBe(1);
      const pixels = await page.evaluate(input => (window as any).numericFixture.span(input.time,50,0),{time:bars[130].time});
      expect(result.warnings.join(" ")).not.toMatch(/line width is limited|offset.*not|not.*offset/);
      if (style === "histogram") expect(Math.abs(pixels.width-12),"12px histogram body").toBeLessThanOrEqual(1);
      else {
        const gapPixels = Math.ceil(pixels.slotWidth*pixels.dpr)<=4 ? 0 : Math.max(1,Math.floor(pixels.dpr));
        expect(Math.abs(pixels.width-(pixels.slotWidth-gapPixels/pixels.dpr)),"column logical cell with declared local pixel gap").toBeLessThanOrEqual(1);
        expect(result.warnings.join(" ")).toMatch(/TradingView|calibrat/i);
      }
      measures.push({width,from,to,pixels});
      await capture(page,style+"-width-"+width+"-zoom-"+from,info.project.name,{...result,pixels},harness);
    }
    if (style === "histogram") expect(Math.abs(measures[0].pixels.width-measures[1].pixels.width)).toBeLessThanOrEqual(1);
    else {
      expect(measures[0].pixels.width).toBe(measures[2].pixels.width); expect(measures[1].pixels.width).toBe(measures[3].pixels.width);
      expect(measures[1].pixels.width).toBeGreaterThan(measures[0].pixels.width*2);
    }
  }
  expect(harness.workerRequests).toHaveLength(6); expect(harness.otherRequests).toEqual([]);
});

test("sparse foreign columns use actual logical slots and shifted visible ranges exclude offscreen outliers", async ({ page, harness }, info) => {
  const chartBars=[...Array.from({length:20},(_,i)=>({...bars[0],time:bars[0].time-(20-i)*60})),...bars.flatMap((bar:any)=>[bar,{...bar,time:bar.time+1},{...bar,time:bar.time+2}])];
  const sparse = await run(page,program('plot(bar_index==128?100:na,title="Sparse columns",color=#ff0000,style=plot.style_columns,histbase=0,offset=2)'),{chartBars,from:398,to:412,bounds:[-20,120]});
  const shifted = await probe(page,bars[128].time,50,2), target = await probe(page,chartBars[406].time,50);
  expect(shifted.logical).toBe(404); expect(shifted.shifted).toBe(406); expect(shifted.x).toBe(target.x); rgb(shifted.rgb,[255,0,0],"foreign slot column");
  expect((await probe(page,bars[128].time,50)).red).toBe(0);
  await capture(page,"sparse-foreign-column",info.project.name,{...sparse,shifted},harness);
  for (const style of ["area","areabr","histogram","columns"]) {
    const result = await run(page,program('plot(bar_index==115?1000000:bar_index==125?100:bar_index==126?110:na,title="Outlier",color=#ff0000,linewidth=4,style=plot.style_'+style+',histbase=0,offset=5)'),{from:125,to:135,bounds:null});
    expect(result.visible.from).toBeGreaterThanOrEqual(120); expect(result.visible.from).toBeLessThan(130); expect(result.visible.to).toBeGreaterThan(131);
    const f=(result.visible.from-120)/10, clipped=1000000*(1-f)+100*f;
    expect(result.range.priceRange.minValue).toBe(style === "areabr" ? 100 : 0);
    expect(result.range.priceRange.maxValue).toBeCloseTo(style === "area" ? Math.max(110,clipped) : 110,6);
    let actual;
    if(style === "area"){const target=Math.ceil(result.visible.from),ratio=(target-120)/10,value=1000000*(1-ratio)+100*ratio;actual=await probe(page,bars[target-5].time,value/2,5);}
    else if(style === "areabr")actual=await probe(page,bars[125].time,103,5,bars[126].time);
    else actual=await probe(page,bars[125].time,50,5);
    expect(actual.red,style+" actual visible body").toBeGreaterThan(0);
    await capture(page,"clipped-"+style,info.project.name,{...result,actual},harness);
  }
  expect(harness.workerRequests).toHaveLength(5); expect(harness.otherRequests).toEqual([]);
});

test("20k packed numeric primitives stay lazy across pan resize and idempotent disposal", async ({ page, harness }, info) => {
  const snapshot=Array.from({length:20000},(_,index)=>({...bars[0],time:bars[0].time+index*60}));
  for (const style of ["area","areabr","histogram","columns"]) {
    const source=program('plot(100+bar_index%10,title="Packed numeric",color=#ff000080,linewidth='+(style==="histogram"?8:2)+',style=plot.style_'+style+',histbase=0,offset=7)');
    const initial=await run(page,source,{bars:snapshot,from:10020,to:10044,bounds:[-20,120]});
    expect(initial.plots[0]).toMatchObject({packed:true,slots:20000,bufferCount:3,bufferBytes:220000}); expect(initial.series).toBe(1);
    expect(initial.stats.decodedSamples).toBeLessThan(100); expect(sample(initial.plots[0],10023)).toMatchObject({time:snapshot[10023].time,value:103});
    rgb((await probe(page,snapshot[10023].time,50,7)).rgb,composite("#ff000080"),style+" packed initial");
    const panned=await page.evaluate(()=>(window as any).numericFixture.pan(15020,15044));
    expect(panned.stats.decodedSamples-initial.stats.decodedSamples).toBeLessThan(100); expect(panned.stats.cacheEntries).toBeLessThanOrEqual(8192);
    const resized=await page.evaluate(()=>(window as any).numericFixture.resize());
    expect(resized.stats.decodedSamples-panned.stats.decodedSamples).toBeLessThan(100);
    rgb((await probe(page,snapshot[15023].time,50,7)).rgb,composite("#ff000080"),style+" packed panned/resized");
    await capture(page,"packed20k-"+style,info.project.name,resized,harness);
    const disposed=await page.evaluate(()=>(window as any).numericFixture.dispose());
    expect(disposed.stats.cacheEntries).toBe(0); expect(disposed.range).toBeNull();
    rgb((await probe(page,snapshot[15023].time,50,7)).rgb,[17,24,39],style+" disposed");
  }
  expect(harness.workerRequests).toHaveLength(4); expect(harness.otherRequests).toEqual([]);
});
