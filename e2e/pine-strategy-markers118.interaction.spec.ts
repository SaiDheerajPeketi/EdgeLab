
import {test,expect} from "@playwright/test";
import {build} from "esbuild";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {context115,start115,minutes115,bars115,bracket115} from "../backend/tests/fixtures/pine-magnifier115.mjs";
const root=path.resolve(import.meta.dirname,".."),artifacts=path.join(root,".artifacts/pine-strategy-markers118/browser");
let server:http.Server,origin:string,workerPath:string,workerBytes:Buffer;
const requests:string[]=[],unexpected:string[]=[];
const fixture=String.raw`
import {createChart} from "../frontend/node_modules/lightweight-charts";
import {createPineRuntimeJob} from "../frontend/src/lib/pineRuntime";
import {adaptPineChartResult} from "../frontend/src/lib/pineChartAdapter";
let state;
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
export async function run(input){
 if(state)state.chart.remove();
 const element=document.querySelector("#chart");element.replaceChildren();
 const result=await createPineRuntimeJob({id:"markers118-browser",action:"run",source:input.source,bars:input.bars,context:input.context,inputs:{},mode:"historical",...(input.minutes===null?{}:{sourceSnapshot:{timeframe:"1",bars:input.minutes}})}).promise;
 const adapted=adaptPineChartResult(result,input.bars);
 const chart=createChart(element,{width:element.clientWidth,height:320,layout:{background:{color:"#111827"},textColor:"#9ca3af"},grid:{vertLines:{visible:false},horzLines:{visible:false}},rightPriceScale:{visible:false},timeScale:{visible:false},crosshair:{vertLine:{visible:false},horzLine:{visible:false}}});
 const series=chart.addCandlestickSeries({upColor:"#889099",downColor:"#889099",wickUpColor:"#889099",wickDownColor:"#889099",borderVisible:false,lastValueVisible:false,priceLineVisible:false});
 series.setData(input.bars.map(({time,open,high,low,close})=>({time,open,high,low,close})));
 series.setMarkers(adapted.strategyMarkers);
 state={element,result,adapted,chart,series,bars:input.bars};chart.timeScale().setVisibleLogicalRange({from:-1,to:3});await paint();
 return summary();
}
export function summary(){
 return {source:state.result.source,inputs:state.result.inputs,audit:state.result.audit,strategy:state.result.strategy,markers:state.adapted.strategyMarkers,attached:state.series.markers(),warnings:state.adapted.adapterWarnings,data:state.series.data()};
}
export function pixels(index){
 const bar=state.bars[index],x=state.chart.timeScale().timeToCoordinate(bar.time),high=state.series.priceToCoordinate(bar.high),low=state.series.priceToCoordinate(bar.low);
 const rect=state.element.getBoundingClientRect(),dpr=devicePixelRatio||1,canvas=document.createElement("canvas");
 canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const context=canvas.getContext("2d");
 for(const layer of state.element.querySelectorAll("canvas")){const r=layer.getBoundingClientRect();context.drawImage(layer,(r.left-rect.left)*dpr,(r.top-rect.top)*dpr,r.width*dpr,r.height*dpr);}
 const data=context.getImageData(0,0,canvas.width,canvas.height).data,counts={greenAbove:0,greenBelow:0,roseAbove:0,roseBelow:0};
 for(let y=0;y<canvas.height;y++)for(let xx=Math.max(0,Math.floor((x-18)*dpr));xx<=Math.min(canvas.width-1,Math.ceil((x+18)*dpr));xx++){
  const at=(y*canvas.width+xx)*4,r=data[at],g=data[at+1],b=data[at+2];
  const green=Math.abs(r-34)<8&&Math.abs(g-197)<8&&Math.abs(b-94)<8,rose=Math.abs(r-251)<8&&Math.abs(g-113)<8&&Math.abs(b-133)<8;
  if(y/dpr<high-1){if(green)counts.greenAbove++;if(rose)counts.roseAbove++;}
  if(y/dpr>low+1){if(green)counts.greenBelow++;if(rose)counts.roseBelow++;}
 }
 return {counts,x,high,low,width:canvas.width,height:canvas.height,dpr};
}
export async function clear(){state.series.setMarkers([]);await paint();return summary();}
export async function restore(){state.series.setMarkers(state.adapted.strategyMarkers);await paint();return summary();}
`;
test.beforeAll(async()=>{
 const assets=path.join(root,"frontend/dist/assets"),name=fs.readdirSync(assets).find(n=>/^pine-native-worker.*\.js$/.test(n));
 if(!name)throw new Error("Frozen production worker required.");
 workerPath="/assets/"+name;workerBytes=fs.readFileSync(path.join(assets,name));
 const required=process.env.EDGELAB_PINE_MARKERS118_SHA;if(!required)throw new Error("EDGELAB_PINE_MARKERS118_SHA required.");
 expect(createHash("sha256").update(workerBytes).digest("hex")).toBe(required);
 const compiled=await build({stdin:{contents:fixture,resolveDir:path.join(root,"e2e"),loader:"ts",sourcefile:"markers118-host.ts"},bundle:true,write:false,platform:"browser",format:"iife",globalName:"markers118Host",
 plugins:[{name:"frozen-worker",setup(builder){builder.onResolve({filter:/^virtual:pine-worker-url$/},()=>({path:"worker",namespace:"frozen"}));builder.onLoad({filter:/.*/,namespace:"frozen"},()=>({contents:"export default "+JSON.stringify(workerPath),loader:"js"}));}}]});
 server=http.createServer((request,response)=>{
  const pathname=new URL(request.url??"/","http://127.0.0.1").pathname;response.setHeader("Cache-Control","no-store");
  if(pathname==="/"){response.setHeader("Content-Type","text/html");response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Production strategy fill marker verification</title><style>html{background:#111827}body{margin:16px}#chart{width:100%}</style><div id="chart"></div><script src="/host.js"></script>');}
  else if(pathname==="/host.js"){response.setHeader("Content-Type","text/javascript");response.end(compiled.outputFiles[0].contents);}
  else if(pathname===workerPath){requests.push(pathname);response.setHeader("Content-Type","text/javascript");response.end(workerBytes);}
  else if(pathname==="/favicon.ico"){response.statusCode=204;response.end();}
  else{unexpected.push(pathname);response.statusCode=404;response.end();}
 });
 await new Promise<void>(resolve=>server.listen(Number(process.env.EDGELAB_PINE_MARKERS118_PORT??45318),"127.0.0.1",resolve));
 origin="http://127.0.0.1:"+((server.address() as any).port);
});
test.afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
test("opaque production minute fills paint native parent-candle markers while exact ledger times stay unchanged",async({page},info)=>{
 const errors:string[]=[],startRequests=requests.length;page.on("pageerror",error=>errors.push(error.message));await page.goto(origin);
 await page.evaluate(()=>{(window as any).sandboxes=[];new MutationObserver(records=>{for(const r of records)for(const node of Array.from(r.addedNodes))if(node instanceof HTMLIFrameElement)(window as any).sandboxes.push(node.getAttribute("sandbox"));}).observe(document.body,{childList:true,subtree:true});});
 const outcomes:any[]=[];
 for(const version of [5,6])for(const scenario of ["closed-long","open-long","closed-short","fallback"]){
  const short=scenario==="closed-short",source=short?"//@version="+version+'\nstrategy("Short markers",use_bar_magnifier=true)\nif bar_index==0\n    strategy.entry("S",strategy.short,limit=115)\n    strategy.exit("X","S",limit=90)':bracket115({version});
  const minutes=scenario==="fallback"?null:minutes115(scenario==="open-long"||short?"high-first":"low-first");
  const result=await page.evaluate(input=>(window as any).markers118Host.run(input),{source,minutes,bars:bars115,context:context115});
  expect(result.source).toBe(source);expect(result.inputs).toEqual({});expect(result.audit.bars).toBe(2);
  expect(result.attached).toEqual(result.markers);expect(result.data.map((b:any)=>b.time)).toEqual(bars115.map(b=>b.time));
  expect(result.markers).toHaveLength(scenario==="open-long"?1:2);
  expect(result.markers.every((m:any)=>m.time===start115+300)).toBe(true);
  const trade=scenario==="open-long"?result.strategy.openTrades[0]:result.strategy.closedTrades[0];
  expect(trade.entry_time).toBe(start115+(scenario==="open-long"?420:300));
  if(scenario!=="open-long")expect(trade.exit_time).toBe(start115+(scenario==="fallback"?300:420));
  expect(trade.entry_bar_index).toBe(1);if(scenario!=="open-long")expect(trade.exit_bar_index).toBe(1);
  const pixels=await page.evaluate(()=>(window as any).markers118Host.pixels(1));
  expect(pixels.counts.greenBelow).toBeGreaterThan(5);
  if(scenario==="open-long")expect(pixels.counts.roseAbove).toBe(0);
  if(scenario!=="open-long")expect(pixels.counts.roseAbove).toBeGreaterThan(5);
  const cleared=await page.evaluate(()=>(window as any).markers118Host.clear()),without=await page.evaluate(()=>(window as any).markers118Host.pixels(1));
  expect(without.counts).toEqual({greenAbove:0,greenBelow:0,roseAbove:0,roseBelow:0});
  expect(cleared.strategy).toEqual(result.strategy);expect(cleared.attached).toEqual([]);
  const restored=await page.evaluate(()=>(window as any).markers118Host.restore()),again=await page.evaluate(()=>(window as any).markers118Host.pixels(1));
  expect(again.counts.greenBelow).toBeGreaterThan(5);if(scenario!=="open-long")expect(again.counts.roseAbove).toBeGreaterThan(5);
  expect(restored.strategy).toEqual(result.strategy);
  outcomes.push({version,scenario,result,pixels,without,restored,again});
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
 }
 const sandboxes=await page.evaluate(()=>(window as any).sandboxes);
 expect(sandboxes).toHaveLength(outcomes.length);expect(sandboxes.every((s:string)=>s==="allow-scripts")).toBe(true);
 expect(requests.length-startRequests).toBe(outcomes.length);expect(errors).toEqual([]);expect(unexpected).toEqual([]);
 const folder=path.join(artifacts,info.project.name);fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,"markers.json"),JSON.stringify({workerPath,bytes:workerBytes.length,sha256:createHash("sha256").update(workerBytes).digest("hex"),outcomes,sandboxes,errors,unexpected},null,2));
});
