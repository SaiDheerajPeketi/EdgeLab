import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {createHash} from "node:crypto";
import {build} from "esbuild";
import {test as base,expect,type Page} from "@playwright/test";
const fixtureBytes=fs.readFileSync(path.resolve("e2e/pine-visuals.bars.json"));
expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars=JSON.parse(fixtureBytes),artifacts=path.resolve(".artifacts/pine-background39/browser");
const pins=JSON.parse(fs.readFileSync(path.resolve("frontend/src/lib/pineCatalogMigrations.json"),"utf8")).entries;
const migration=(stem:string)=>fs.readFileSync(path.resolve("frontend/public","."+pins.find((pin:any)=>pin.path.endsWith("/"+stem+".pine")).sourcePath),"utf8");
// Purpose-built real-chart harness: no replaced worker, bridge or engine result.
const fixtureSource=String.raw`
import {createChart} from "../frontend/node_modules/lightweight-charts";
import {createPineRuntimeJob} from "../frontend/src/lib/pineRuntime";
import {adaptPineChartResult,installPineChartPlots,latestPineChartPoint} from "../frontend/src/lib/pineChartAdapter";
import {getPackedPinePlot,pointAtBar} from "../frontend/src/lib/pinePacked";
let state;
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function clean(){if(state)for(const p of state.placements){p.installed.dispose();p.chart.remove();}state=undefined;for(const el of document.querySelectorAll(".chart")){el.replaceChildren();el.hidden=true;}}
export async function run(input){
 clean();
 const result=await createPineRuntimeJob({action:"run",source:input.source,bars:input.bars,inputs:input.inputs??{},context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1},mode:"historical"}).promise;
 const adapted=adaptPineChartResult(result,input.bars),placements=[];
 for(const overlay of [true,false]){
  const plots=adapted.plots.filter(plot=>plot.overlay===overlay);if(!plots.length&&!overlay)continue;
  const element=document.querySelector(overlay?"#main":"#pane");element.hidden=false;
  const chart=createChart(element,{width:element.clientWidth,height:180,layout:{background:{color:"#111827"},textColor:"#cbd5e1"},grid:{vertLines:{visible:false},horzLines:{visible:false}},rightPriceScale:{borderVisible:false},timeScale:{visible:false},crosshair:{vertLine:{visible:false},horzLine:{visible:false}}});
  const bounds=input.bounds??[80,120];let base;
  if(overlay||!input.noPrice){
   const options={lastValueVisible:false,priceLineVisible:false,autoscaleInfoProvider:()=>({priceRange:{minValue:bounds[0],maxValue:bounds[1]}})};
   base=overlay?chart.addCandlestickSeries({...options,upColor:"#475569",downColor:"#475569",wickUpColor:"#475569",wickDownColor:"#475569",borderVisible:false}):chart.addLineSeries({...options,color:"transparent",lineVisible:false});
   base.setData(overlay?(input.chartBars??input.bars).map(({time,open,high,low,close})=>({time,open,high,low,close})):input.bars.map(bar=>({time:bar.time,value:bounds[0]})));
  }
  const installed=installPineChartPlots(chart,plots,"right",{allowFillOnlyScale:!overlay,scaleAnchor:overlay?(input.chartBars??input.bars).at(-1):undefined});
  chart.timeScale().setVisibleLogicalRange({from:input.from??120,to:input.to??144});
  placements.push({overlay,element,chart,base,installed});
 }
 state={result,adapted,placements,bars:input.bars};await paint();return summary();
}
export function summary(){return {engine:state.result.audit.engineVersion,source:state.result.source,inputs:state.result.inputs,definitions:state.result.inputDefinitions,
 plots:state.result.plots.map(plot=>({id:plot.id,name:plot.name,style:plot.style,overlay:plot.overlay,options:plot.options,packed:!!getPackedPinePlot(plot),samples:[0,120,121,122,130,state.bars.length-1].filter(i=>i<state.bars.length).map(i=>getPackedPinePlot(plot)?pointAtBar(plot,i):plot.points[i])})),
 warnings:state.adapted.adapterWarnings,drawn:state.adapted.plots.map(plot=>({id:plot.id,name:plot.name,kind:plot.kind,overlay:plot.overlay,latest:latestPineChartPoint(plot)})),
 placements:state.placements.map(p=>({overlay:p.overlay,height:p.chart.paneSize().height,visible:p.chart.timeScale().getVisibleLogicalRange(),range:p.installed.primitive?.rangeForVisible(),stats:p.installed.primitive?.debugStats,primaryCoordinate:p.base?.priceToCoordinate(100)}))};}
// Preserve actual native bitmap pixels at DPR2; a CSS-sized composite would resample them.
function image(p){const rect=p.element.getBoundingClientRect(),canvas=document.createElement("canvas"),ratio=devicePixelRatio||1;canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);const ctx=canvas.getContext("2d");for(const layer of p.element.querySelectorAll("canvas")){const r=layer.getBoundingClientRect();ctx.drawImage(layer,(r.left-rect.left)*ratio,(r.top-rect.top)*ratio,r.width*ratio,r.height*ratio);}return {width:canvas.width,height:canvas.height,ratio,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data};}
export function pixel(time,y,{overlay=false,dx=0,edge=false,offset=0,price}={}){
 const p=state.placements.find(p=>p.overlay===overlay),scale=p.chart.timeScale();let x=scale.timeToCoordinate(time);
 const logical=scale.coordinateToLogical(x),center=scale.logicalToCoordinate(logical+offset);
 x=edge?(center+scale.logicalToCoordinate(logical+offset+1))/2:center;if(price!==undefined)y=p.base.priceToCoordinate(price);
 x+=dx;const size=p.chart.paneSize();
 if(x<0||x>=size.width||y<0||y>=size.height)throw new Error("Requested pixel is outside actual pane "+JSON.stringify({x,y,size,visible:scale.getVisibleLogicalRange()}));
 const data=image(p),px=Math.round(x*data.ratio),py=Math.round(y*data.ratio),o=(py*data.width+px)*4;
 return {x,y,width:size.width,height:size.height,dpr:data.ratio,rgb:Array.from(data.pixels.slice(o,o+3))};
}
export async function pan(from,to){for(const p of state.placements)p.chart.timeScale().setVisibleLogicalRange({from,to});await paint();return summary();}
export async function resize(){for(const p of state.placements)p.chart.resize(p.element.clientWidth,128);await paint();return summary();}
export async function dispose(){for(const p of state.placements){p.installed.dispose();p.installed.dispose();}await paint();return summary();}
`;
type Harness={origin:string;workerRequests:string[];otherRequests:string[]};
const test=base.extend<{harness:Harness},{serverHarness:Harness}>({
 serverHarness:[async({},use)=>{
  const assets=path.resolve("frontend/dist/assets"),workerName=fs.readdirSync(assets).find(name=>/^pine-native-worker.*\.js$/.test(name));
  if(!workerName)throw new Error("Root must freeze/build production first");
  const workerPath="/assets/"+workerName,worker=fs.readFileSync(path.join(assets,workerName));
  const compiled=await build({stdin:{contents:fixtureSource,resolveDir:path.resolve("e2e"),loader:"ts",sourcefile:"background-proof.ts"},bundle:true,write:false,platform:"browser",format:"iife",globalName:"backgroundFixture",
   plugins:[{name:"actual-production-worker",setup(builder){builder.onResolve({filter:/^virtual:pine-worker-url$/},()=>({path:"worker",namespace:"actual-worker"}));builder.onLoad({filter:/.*/,namespace:"actual-worker"},()=>({contents:"export default "+JSON.stringify(workerPath),loader:"js"}));}}]});
  const workerRequests:string[]=[],otherRequests:string[]=[];
  const server=http.createServer((request,response)=>{
   const pathname=new URL(request.url??"/","http://127.0.0.1").pathname;response.setHeader("Cache-Control","no-store");
   if(pathname==="/"){response.setHeader("Content-Type","text/html");response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native Pine backgrounds</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}h1{font-size:20px}.chart{width:100%;margin-bottom:20px}</style><h1>Native Pine background · actual chart canvas</h1><div id="main" class="chart"></div><div id="pane" class="chart" hidden></div><script src="/fixture.js"></script>');}
   else if(pathname==="/fixture.js"){response.setHeader("Content-Type","text/javascript");response.end(compiled.outputFiles[0].contents);}
   else if(pathname===workerPath){workerRequests.push(pathname);response.setHeader("Content-Type","text/javascript");response.end(worker);}
   else if(pathname==="/favicon.ico"){response.statusCode=204;response.end();}
   else{otherRequests.push(pathname);response.statusCode=404;response.end();}
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();if(!address||typeof address==="string")throw new Error("No fixture port");
  try{await use({origin:"http://127.0.0.1:"+address.port,workerRequests,otherRequests});}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 },{scope:"worker"}],
 harness:async({page,serverHarness},use)=>{serverHarness.workerRequests.length=0;serverHarness.otherRequests.length=0;await page.goto(serverHarness.origin);await use(serverHarness);},
});
const program=(body:string,overlay=false)=>'//@version=6\nindicator("Background pixel proof",overlay='+overlay+')\n'+body;
async function run(page:Page,source:string,options:any={}){
 const result=await page.evaluate(input=>(window as any).backgroundFixture.run(input),{source,bars,...options});
 expect(result.engine).toBe("0.11.0");expect(result.source).toBe(source);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);return result;
}
const pixel=(page:Page,time:number,y:number,options:any={})=>page.evaluate(input=>(window as any).backgroundFixture.pixel(input.time,input.y,input.options),{time,y,options});
const composite=(hex:string|null,under=[17,24,39])=>{if(hex===null)return under;const h=hex.replace("#",""),alpha=h.length===8?parseInt(h.slice(6),16)/255:1;return under.map((v,index)=>Math.round(parseInt(h.slice(index*2,index*2+2),16)*alpha+v*(1-alpha)));};
function rgbNear(actual:number[],expected:number[],message:string){for(let i=0;i<3;i++)expect(Math.abs(actual[i]-expected[i]),message+" channel"+i).toBeLessThanOrEqual(2);}
async function capture(page:Page,name:string,project:string){fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,name+"-"+project+".png")});}

test("actual migrated Stochastic MFI and TRIX retain dynamic background pixels and toggled transparency",async({page,harness},info)=>{
 for(const [stem,toggle]of [["stochastic","Highlight Middle Line Crossovers ?"],["mfi_money_flow_index","Highlight Middle Line Crossovers ?"],["trix","Highlight Zero Line Crossovers ?"]]){
  const source=migration(stem),first=await run(page,source,{bounds:[-50,150]});
  const definition=first.definitions.find((entry:any)=>entry.title===toggle);expect(definition).toBeTruthy();
  const active=await run(page,source,{inputs:{[definition.id]:true},bounds:[-50,150]});
  const bg=active.plots.find((plot:any)=>plot.style==="background");
  expect(active.drawn.some((plot:any)=>plot.id===bg.id&&plot.kind==="background"&&plot.latest===null)).toBe(true);
  expect(active.warnings.filter((warning:string)=>/background.*not rendered|unsupported.*background/i.test(warning))).toEqual([]);
  const sample=bg.samples.find((point:any)=>point?.time===bars[130].time);expect(sample.value).toBe(true);
  for(const y of [5,175])rgbNear((await pixel(page,bars[130].time,y)).rgb,composite(sample.options.color),stem+" fullheight");
  await capture(page,stem+"-background",info.project.name);
  await run(page,source,{inputs:{[definition.id]:false},bounds:[-50,150]});
  for(const y of [5,175])rgbNear((await pixel(page,bars[130].time,y)).rgb,[17,24,39],stem+" disabled");
 }
 expect(harness.workerRequests).toHaveLength(9);expect(harness.otherRequests).toEqual([]);
});

test("positional flags and source order put opaque background below fill and primary candles",async({page,harness},info)=>{
 const source=program('a=plot(90,"Lower",display=display.none)\nb=plot(110,"Upper",display=display.none)\nfill(a,b,color=#00ff0080,title="Fill")\nbgcolor(#ff0000)\nbgcolor(#00ff00)\nbgcolor(#00ffff,title="Same")\nbgcolor(#ffff00,title="Same")\nbgcolor(#ff0000,0,false,256,"2",display.all,true)\nbgcolor(#0000ff,0,true,256,"1",display.all,true)',true);
 const result=await run(page,source),backgrounds=result.plots.filter((plot:any)=>plot.style==="background");
 expect(backgrounds).toHaveLength(6);expect(new Set(backgrounds.map((plot:any)=>plot.id)).size).toBe(6);
 expect(backgrounds.slice(2).map((plot:any)=>plot.name)).toEqual(["Same","Same","2","1"]);expect(backgrounds.every((plot:any)=>plot.overlay)).toBe(true);
 expect(backgrounds.slice(-2).map((plot:any)=>plot.options.editable)).toEqual([false,true]);
 rgbNear((await pixel(page,bars[121].time,5,{overlay:true})).rgb,[0,0,255],"last call wins despite numeric title sort");
 const fillPixel=await pixel(page,bars[121].time,0,{overlay:true,price:100});
 rgbNear(fillPixel.rgb,composite("#00ff0080",[0,0,255]),"fill above opaque background");
 const candle=await pixel(page,bars[121].time,0,{overlay:true,price:(bars[121].open+bars[121].close)/2});
 rgbNear(candle.rgb,[71,85,105],"primary candle above background and fill");
 await capture(page,"source-order-layering",info.project.name);expect(harness.otherRequests).toEqual([]);
});

test("adjacent equal alpha backgrounds have no fractional zoom or DPR seams and need no price range",async({page,harness},info)=>{
 const result=await run(page,program('bgcolor(#ff000080,title="Continuous alpha")'),{from:120.13,to:143.77,noPrice:true});
 expect(result.placements.find((p:any)=>!p.overlay).range).toBeNull();expect(result.drawn.find((p:any)=>p.kind==="background").latest).toBeNull();
 const expected=composite("#ff000080");
 for(const index of [122,130,138])for(const dx of [-2,-1.5,-1,-.5,0,.5,1,1.5,2])rgbNear((await pixel(page,bars[index].time,20,{edge:true,dx})).rgb,expected,"adjacent alpha seam");
 await capture(page,"fractional-alpha-no-price",info.project.name);expect(harness.workerRequests).toHaveLength(1);expect(harness.otherRequests).toEqual([]);
});

test("integer offsets shift source colors into past and future chart slots without price expansion",async({page,harness},info)=>{
 for(const [index,offset,from,to]of [[255,5,254,262],[0,-5,-7,1]]){
  const result=await run(page,program('bgcolor(bar_index=='+index+'?#ff0000:na,title="Shifted shade",offset='+offset+',show_last='+(offset>0?1:256)+')'),{from,to,noPrice:true});
  const pane=result.placements.find((p:any)=>!p.overlay),target=index+offset;
  expect(pane.range).toBeNull();expect(pane.visible.from,JSON.stringify(pane.visible)).toBeLessThanOrEqual(target);expect(pane.visible.to,JSON.stringify(pane.visible)).toBeGreaterThanOrEqual(target);
  for(const y of [5,90,175]){
   const actual=await pixel(page,bars[index].time,y,{offset});
   expect(actual.x).toBeGreaterThanOrEqual(0);expect(actual.x).toBeLessThan(actual.width);
   rgbNear(actual.rgb,[255,0,0],"shifted off-history band "+JSON.stringify({index,offset,pane: pane.visible,pixel:actual}));
  }
  await capture(page,offset>0?"future-offset":"past-offset",info.project.name);
 }
 expect(harness.workerRequests).toHaveLength(2);expect(harness.otherRequests).toEqual([]);
});

test("20k packed background pixels stay lazy across pan resize and disposal",async({page,harness},info)=>{
 const snapshot=Array.from({length:20000},(_,index)=>({...bars[0],time:bars[0].time+index*60}));
 const source=program('bgcolor(bar_index%3==0?na:bar_index%3==1?#ff000080:#0000ff,title="Packed shade")');
 const result=await run(page,source,{bars:snapshot,from:10000,to:10024,noPrice:true});
 expect(result.plots[0].packed).toBe(true);expect(result.placements.find((p:any)=>!p.overlay).stats.decodedSamples).toBeLessThan(40);
 const next=await page.evaluate(()=>(window as any).backgroundFixture.pan(15000,15024));
 expect(next.placements.find((p:any)=>!p.overlay).stats.decodedSamples-result.placements.find((p:any)=>!p.overlay).stats.decodedSamples).toBeLessThan(40);
 rgbNear((await pixel(page,snapshot[15001].time,10)).rgb,composite("#ff000080"),"panned packed color");
 await page.evaluate(()=>(window as any).backgroundFixture.resize());
 rgbNear((await pixel(page,snapshot[15001].time,123)).rgb,composite("#ff000080"),"resized fullheight");
 await capture(page,"packed20k-background",info.project.name);
 const disposed=await page.evaluate(()=>(window as any).backgroundFixture.dispose());expect(disposed.placements.find((p:any)=>!p.overlay).stats.cacheEntries).toBe(0);
 rgbNear((await pixel(page,snapshot[15001].time,10)).rgb,[17,24,39],"disposed");
 expect(harness.workerRequests).toHaveLength(1);expect(harness.otherRequests).toEqual([]);
});
