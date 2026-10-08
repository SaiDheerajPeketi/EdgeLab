
import {test,expect,type Page} from "@playwright/test";
import {build} from "esbuild";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {bars116,fillSource116} from "../backend/tests/fixtures/pine-fill-offset116.mjs";

const root=path.resolve(import.meta.dirname,".."),artifacts=path.join(root,".artifacts/pine-fill-offset116/browser");
let server:http.Server,origin:string,workerPath:string,workerBytes:Buffer;
const requests:string[]=[],unexpected:string[]=[];
const fixture=String.raw`
import {createChart} from "../frontend/node_modules/lightweight-charts";
import {createPineRuntimeJob} from "../frontend/src/lib/pineRuntime";
import {adaptPineChartResult,installPineChartPlots} from "../frontend/src/lib/pineChartAdapter";
import {getPackedPinePlot,pointAtBar} from "../frontend/src/lib/pinePacked";
let state;
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
export async function run(input){
 if(state){state.installed.dispose();state.chart.remove();}
 const element=document.querySelector("#chart");element.replaceChildren();
 const result=await createPineRuntimeJob({action:"run",source:input.source,bars:input.bars,inputs:input.inputs??{},mode:"historical",context:{symbol:"CHART:TEST",timeframe:"1",mintick:.01,pointvalue:1}}).promise;
 const adapted=adaptPineChartResult(result,input.bars);
 const chart=createChart(element,{width:element.clientWidth,height:240,layout:{background:{color:"#111827"},textColor:"#cbd5e1"},grid:{vertLines:{visible:false},horzLines:{visible:false}},rightPriceScale:{visible:false,borderVisible:false},timeScale:{visible:false},crosshair:{vertLine:{visible:false},horzLine:{visible:false}}});
 const base=chart.addLineSeries({color:"transparent",lineVisible:false,lastValueVisible:false,priceLineVisible:false,autoscaleInfoProvider:()=>({priceRange:{minValue:input.bounds?.[0]??-20,maxValue:input.bounds?.[1]??40}})});
 const timeline=input.timeline??input.bars;base.setData(timeline.map(bar=>({time:bar.time,value:0})));
 const installed=installPineChartPlots(chart,adapted.plots,"right",{scaleAnchor:timeline.at(-1)});
 state={result,adapted,chart,base,installed,element,bars:input.bars};
 chart.timeScale().setVisibleLogicalRange({from:input.from??-4,to:input.to??12});await paint();return summary();
}
export function summary(){
 const scale=state.chart.timeScale(),width=state.chart.paneSize().width,x0=scale.logicalToCoordinate(0),x1=scale.logicalToCoordinate(1);
 return {source:state.result.source,inputs:state.result.inputs,definitions:state.result.inputDefinitions,drawn:state.adapted.plots.map(p=>({kind:p.kind,name:p.name})),warnings:state.adapted.adapterWarnings,
 plots:state.result.plots.map(p=>({id:p.id,name:p.name,options:p.options,packed:!!getPackedPinePlot(p),first:pointAtBar(p,0)??p.points[0],last:pointAtBar(p,state.bars.length-1)??p.points.at(-1)})),
 range:state.installed.primitive.rangeForVisible(),stats:state.installed.primitive.debugStats,physical:{from:-x0/(x1-x0),to:(width-x0)/(x1-x0),x0,x1,width},advertised:scale.getVisibleLogicalRange()};
}
export function probe(logical,price,pixel){
 const scale=state.chart.timeScale(),lo=Math.floor(logical),hi=Math.ceil(logical),a=scale.logicalToCoordinate(lo),b=scale.logicalToCoordinate(hi);
 const x=pixel??a+(b-a)*(logical-lo),y=(state.disposed?state.base:state.installed.series[0]??state.base).priceToCoordinate(price),size=state.chart.paneSize();
 if(x===null||y===null||!Number.isFinite(x+y)||x<0||x>=size.width||y<0||y>=size.height)throw new Error("Pixel outside actual pane "+JSON.stringify({logical,price,x,y,size}));
 const rect=state.element.getBoundingClientRect(),ratio=devicePixelRatio||1,canvas=document.createElement("canvas");
 canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);const ctx=canvas.getContext("2d");
 for(const layer of state.element.querySelectorAll("canvas")){const r=layer.getBoundingClientRect();ctx.drawImage(layer,(r.left-rect.left)*ratio,(r.top-rect.top)*ratio,r.width*ratio,r.height*ratio);}
 const xx=Math.min(canvas.width-1,Math.round(x*ratio)),yy=Math.min(canvas.height-1,Math.round(y*ratio));
 return {x,y,logical,price,width:size.width,rgb:Array.from(ctx.getImageData(xx,yy,1,1).data).slice(0,3)};
}
export async function pan(from,to){state.chart.timeScale().setVisibleLogicalRange({from,to});await paint();return summary();}
export async function resize(){state.chart.resize(state.element.clientWidth,180);await paint();return summary();}
export async function dispose(){state.installed.dispose();state.installed.dispose();state.disposed=true;await paint();return {stats:state.installed.primitive.debugStats};}
`;
test.beforeAll(async()=>{
 const assets=path.join(root,"frontend/dist/assets"),name=fs.readdirSync(assets).find(n=>/^pine-native-worker.*\.js$/.test(n));
 if(!name)throw new Error("Final production build required.");
 workerPath="/assets/"+name;workerBytes=fs.readFileSync(path.join(assets,name));
 const required=process.env.EDGELAB_PINE_FILL116_SHA;
 if(!required)throw new Error("EDGELAB_PINE_FILL116_SHA must bind the frozen production asset.");
 expect(createHash("sha256").update(workerBytes).digest("hex")).toBe(required);
 const bundle=await build({stdin:{contents:fixture,resolveDir:path.join(root,"e2e"),loader:"ts",sourcefile:"fill116-host.ts"},bundle:true,write:false,platform:"browser",format:"iife",globalName:"fill116Host",
 plugins:[{name:"frozen-worker",setup(builder){builder.onResolve({filter:/^virtual:pine-worker-url$/},()=>({path:"worker",namespace:"frozen"}));builder.onLoad({filter:/.*/,namespace:"frozen"},()=>({contents:"export default "+JSON.stringify(workerPath),loader:"js"}));}}]});
 server=http.createServer((request,response)=>{
  const pathname=new URL(request.url??"/","http://127.0.0.1").pathname;response.setHeader("Cache-Control","no-store");
  if(pathname==="/"){response.setHeader("Content-Type","text/html");response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Production shifted fills verification</title><style>html{background:#111827}body{margin:16px}#chart{width:100%}</style><div id="chart"></div><script src="/host.js"></script>');}
  else if(pathname==="/host.js"){response.setHeader("Content-Type","text/javascript");response.end(bundle.outputFiles[0].contents);}
  else if(pathname===workerPath){requests.push(pathname);response.setHeader("Content-Type","text/javascript");response.end(workerBytes);}
  else if(pathname==="/favicon.ico"){response.statusCode=204;response.end();}
  else{unexpected.push(pathname);response.statusCode=404;response.end();}
 });
 await new Promise<void>(resolve=>server.listen(Number(process.env.EDGELAB_PINE_FILL116_PORT??45316),"127.0.0.1",resolve));
 origin="http://127.0.0.1:"+((server.address() as any).port);
});
test.afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
async function setup(page:Page){
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));await page.goto(origin);
 await page.evaluate(()=>{(window as any).sandboxes=[];new MutationObserver(records=>{for(const r of records)for(const node of Array.from(r.addedNodes))if(node instanceof HTMLIFrameElement)(window as any).sandboxes.push(node.getAttribute("sandbox"));}).observe(document.body,{childList:true,subtree:true});});
 return {errors,start:requests.length};
}
async function run(page:Page,source:string,options:any={}){
 const summary=await page.evaluate(input=>(window as any).fill116Host.run(input),{source,bars:bars116,...options});
 expect(summary.source).toBe(source);expect(summary.drawn.filter((p:any)=>p.kind==="fill")).toHaveLength(1);
 await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);return summary;
}
const probe=(page:Page,logical:number,price:number,pixel?:number)=>page.evaluate(input=>(window as any).fill116Host.probe(input.logical,input.price,input.pixel),{logical,price,pixel});
function rgb(value:any,wanted:number[]){for(let c=0;c<3;c++)expect(Math.abs(value.rgb[c]-wanted[c]),JSON.stringify(value)).toBeLessThanOrEqual(3);}
async function receipt(page:Page,info:any,label:string,setup:any,outcomes:any[]){
 const sandboxes=await page.evaluate(()=>(window as any).sandboxes);
 expect(sandboxes).toHaveLength(outcomes.filter(o=>o.source).length);
 expect(sandboxes.every((s:string)=>s==="allow-scripts")).toBe(true);
 expect(requests.length-setup.start).toBe(sandboxes.length);expect(setup.errors).toEqual([]);expect(unexpected).toEqual([]);
 const folder=path.join(artifacts,info.project.name);fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,label+".json"),JSON.stringify({workerPath,bytes:workerBytes.length,sha256:createHash("sha256").update(workerBytes).digest("hex"),sandboxes,outcomes,errors:setup.errors,unexpected},null,2));
}

test("opaque production runs paint saved shifted IDs, sparse alignment, source colors and gradients on real LWC",async({page},info)=>{
 const check=await setup(page),outcomes:any[]=[];
 for(const version of [5,6])for(const offset of [-2,2]){
  const source=fillSource116({version,inputs:true}),s=await run(page,source,{inputs:{in_0:offset}});
  expect(s.inputs).toEqual({in_0:offset});expect(s.definitions.map((d:any)=>d.id)).toEqual(["in_0"]);
  expect(s.plots[0].first).toMatchObject({time:bars116[0].time,value:10});expect(s.plots[0].options.offset).toBe(offset);
  const painted=await probe(page,3.5+offset,5.25),empty=await probe(page,-.5+offset,5.25);rgb(painted,[255,0,0]);rgb(empty,[17,24,39]);outcomes.push({...s,painted,empty});
 }
 for(const reverse of [false,true]){
  const s=await run(page,fillSource116({upperOffset:1,lowerOffset:0,color:"bar_index%2==0?#ff0000:#0000ff",reverse}));
  const actual=await probe(page,3.5,4.25);rgb(actual,reverse?[255,0,0]:[0,0,255]);outcomes.push({...s,actual});
 }
 const sparse=[bars116[0],bars116[3],bars116[7]];
 const s=await run(page,fillSource116({upper:"10+10*bar_index",lower:"-10+5*bar_index",upperOffset:2,lowerOffset:-1}),{bars:sparse,timeline:bars116,from:3,to:5});
 const actual=await probe(page,4,5);rgb(actual,[255,0,0]);outcomes.push({...s,actual});
 const cut=await run(page,fillSource116({upperOffset:2,upperFlags:",show_last=2",lowerFlags:",show_last=4",fillFlags:",show_last=3"}));
 rgb(await probe(page,8.5,5),[255,0,0]);rgb(await probe(page,7.5,5),[17,24,39]);outcomes.push(cut);
 for(const bridge of [false,true]){
  const g=await run(page,fillSource116({upper:"bar_index==3?na:10+2*bar_index",lower:"-10",upperOffset:2,fillFlags:",fillgaps="+bridge}));
  const actual=await probe(page,4.5,5);rgb(actual,bridge?[255,0,0]:[17,24,39]);outcomes.push({...g,actual});
 }
 const gradient=await run(page,fillSource116({upper:"30",lower:"-10",upperOffset:2,lowerOffset:0,gradient:"20,0,#ff0000,#0000ff"}));
 const blend=await probe(page,3.5,10);expect(blend.rgb[0]).toBeGreaterThan(110);expect(blend.rgb[2]).toBeGreaterThan(110);expect(blend.rgb[1]).toBeLessThan(4);outcomes.push({...gradient,blend});
 await receipt(page,info,"painted",check,outcomes);
});

test("actual fractional pane-edge pixels and packed pan/resize disposal retain exact visible fill bounds",async({page},info)=>{
 const check=await setup(page),outcomes:any[]=[];
 const edge=await run(page,fillSource116({upper:"bar_index==0 or bar_index==6?1000:20",lower:"0",upperOffset:1,lowerOffset:0}),{from:2,to:6,bounds:[0,1100]});
 const {from,to,width}=edge.physical;
 expect(from).toBeLessThan(edge.advertised.from);expect(to).toBeGreaterThan(edge.advertised.to);
 const expected=Math.max(from<2?1000+(20-1000)*(from-1):20,to>6?20+980*(to-6):20);
 expect(edge.range.priceRange.minValue).toBe(0);expect(edge.range.priceRange.maxValue).toBeCloseTo(expected,7);expect(edge.range.priceRange.maxValue).toBeLessThan(1000);
 const left=await probe(page,from,30,2),right=await probe(page,to,30,width-3);rgb(left,[255,0,0]);rgb(right,[255,0,0]);outcomes.push({...edge,left,right,expected});
 const bars=Array.from({length:20000},(_,i)=>({...bars116[0],time:bars116[0].time+i*60}));
 const packed=await run(page,fillSource116({upper:"20",lower:"-10",upperOffset:5,lowerOffset:-3}),{bars,from:10000,to:10020});
 expect(packed.plots.every((p:any)=>p.packed)).toBe(true);expect(packed.stats.decodedSamples).toBeLessThan(300);
 rgb(await probe(page,10010.5,5),[255,0,0]);outcomes.push(packed);
 const panned=await page.evaluate(()=>(window as any).fill116Host.pan(15000,15020));
 rgb(await probe(page,15010.5,5),[255,0,0]);expect(panned.stats.decodedSamples-packed.stats.decodedSamples).toBeLessThan(300);expect(panned.stats.cacheEntries).toBeLessThan(600);
 const resized=await page.evaluate(()=>(window as any).fill116Host.resize());rgb(await probe(page,15010.5,5),[255,0,0]);
 const disposed=await page.evaluate(()=>(window as any).fill116Host.dispose());expect(disposed.stats.cacheEntries).toBe(0);rgb(await probe(page,15010.5,5),[17,24,39]);
 outcomes.push({panned,resized,disposed});
 await receipt(page,info,"bounds-packed",check,outcomes);
});
