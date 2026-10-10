import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor } from "./pine-layering.product-support";

const price=(value:number,precision:number)=>new Intl.NumberFormat("en-US",{minimumFractionDigits:precision,maximumFractionDigits:precision}).format(value);
const hash=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
const seal=()=>hash(fs.readdirSync("frontend/dist",{recursive:true}).map(String).filter(file=>fs.statSync(path.join("frontend/dist",file)).isFile()).sort()
  .map(file=>file+":"+hash(fs.readFileSync(path.join("frontend/dist",file)))).join("\n"));
async function observe(page:Page) {
  const errors:string[]=[],sandboxErrors:string[]=[],workers:any[]=[];
  page.on("pageerror",error=>error.message.includes("Service worker is disabled because the context is sandboxed")?sandboxErrors.push(error.message):errors.push(error.message));
  await page.addInitScript(()=>{if(window!==window.top)return;(window as any).__display187=[];
    addEventListener("message",event=>{const frame=[...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')]
      .find(item=>item.contentWindow===event.source&&item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if(frame&&event.origin==="null"&&event.data?.type==="result")(window as any).__display187.push(event.data.payload);},true);});
  await page.route("**/assets/pine-native-worker*.js",async route=>{const response=await route.fetch(),bytes=await response.body();workers.push({url:route.request().url(),bytes:bytes.length,sha256:hash(bytes)});await route.fulfill({response,body:bytes});});
  return {errors,sandboxErrors,workers};
}
async function runs(page:Page,source:string) { return page.evaluate(source=>((window as any).__display187??[]).flatMap((payload:any)=>{
  const response=payload.protocol==="pine-live-v1"?payload.response:payload,result=response?.result;
  return response?.status==="completed"&&result?.kind==="run"&&result.source===source?[{...result,sessionId:payload.sessionId,sequence:payload.sequence,
    plots:result.plots.map((plot:any)=>({...plot,points:plot.packed?undefined:plot.points}))}]:[];}),source); }
async function chart(page:Page,index?:number,remember=false,clear=false) {
  if(index!==undefined)await page.locator(".chart-stage .tv-lightweight-charts").first().scrollIntoViewIfNeeded();
  const state=await page.evaluate(async({index,remember})=>{
  const stage=document.querySelector<HTMLElement>(".chart-stage")!,key=Object.keys(stage).find(key=>key.startsWith("__reactFiber$"));let api:any,candles:any;
  for(let fiber=key?(stage as any)[key]:null,depth=0;fiber&&depth<64;fiber=fiber.return,depth++)for(let hook=fiber.memoizedState,n=0;hook&&n<384;hook=hook.next,n++){
    const ref=hook.memoizedState?.current;if(!ref)continue;if(!api&&typeof ref.timeScale==="function"&&typeof ref.addCandlestickSeries==="function")api=ref;
    if(typeof ref.seriesType==="function"&&ref.seriesType()==="Candlestick")candles??=ref;}
  if(!api||!candles)throw Error("Actual chart/series refs unavailable");
  if(remember)(window as any).__displayOwners187={api,candles};
  if(index!==undefined){const row=candles.data()[index];api.timeScale().setVisibleLogicalRange({from:index-8,to:index+8});
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));}
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  const owner=(window as any).__displayOwners187;
  const row=index===undefined?undefined:candles.data()[index],rect=stage.querySelector(".tv-lightweight-charts")!.getBoundingClientRect();
  return {rows:candles.data(),sameOwner:!owner||owner.api===api&&owner.candles===candles,range:api.timeScale().getVisibleLogicalRange(),pane:api.paneSize(),
    target:row?{x:rect.left+api.timeScale().timeToCoordinate(row.time),y:rect.top+candles.priceToCoordinate(row.close),time:row.time}:undefined};
},{index,remember});
  if(state.target){
    expect(state.target.x).toBeGreaterThan(0);expect(state.target.x).toBeLessThan(page.viewportSize()!.width);
    expect(state.target.y).toBeGreaterThan(0);expect(state.target.y).toBeLessThan(page.viewportSize()!.height);
    await page.mouse.move(state.target.x,state.target.y);
  }
  if(clear)await page.mouse.move(0,0);
  return state;
}
async function save(page:Page,info:TestInfo,before:string,name:string,evidence:any) {
  expect(seal()).toBe(before);const directory=path.resolve(".artifacts/pine-display187",info.project.name);fs.mkdirSync(directory,{recursive:true});
  await page.screenshot({path:path.join(directory,name+".png"),animations:"disabled"});
  fs.writeFileSync(path.join(directory,name+".json"),JSON.stringify({beforeSeal:before,afterSeal:seal(),fixtures:Object.fromEntries(["e2e/display187.config.ts","e2e/display187.interaction.spec.ts"].map(file=>[file,hash(fs.readFileSync(file))])),...evidence},null,2));
}
const appSource=`//@version=6
indicator("Display destinations187",overlay=true,format=format.price,precision=3)
factor=input.float(2,"Multiplier")
plot(close*factor,"Repeated",display=display.status_line+display.data_window)
plot(close+1,"Repeated",display=display.data_window)
plot(bar_index%2==0?na:close,"Gap",display=display.status_line+display.data_window)
plotshape(bar_index%2==0,"Boolean",display=display.status_line+display.data_window)
plotcandle(open,high,low,close,"OHLC",display=display.data_window)
plot(close,"Pane only",display=display.pane,color=#ff0000)
plot(close*1000,"Hidden",display=display.none)`;

test("saved custom Pine source exposes exact hovered destinations and NA, with live input reruns preserving chart ownership",async({page},info)=>{
  const before=seal(),observed=await observe(page),feed=await liveViewportSetup(page),current=feed.emit(600,67530,false,15);
  await chart(page,undefined,true);
  const dialog=await editor(page);await dialog.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source",{exact:true}).fill(appSource);await dialog.getByRole("button",{name:"Check script",exact:true}).click();
  await expect(dialog.getByRole("button",{name:"Add to chart",exact:true})).toBeEnabled();await dialog.getByRole("button",{name:"Add to chart",exact:true}).click();
  await dialog.getByRole("button",{name:"Close indicator editor",exact:true}).click();
  await expect.poll(async()=>(await runs(page,appSource)).some(result=>result.sessionId&&result.audit.bars===601)).toBe(true);
  const initial=(await runs(page,appSource)).filter(result=>result.sessionId).at(-1)!;expect(initial.plots).toHaveLength(7);
  expect(new Set(initial.plots.map((plot:any)=>plot.id)).size).toBe(7);
  const data=page.getByRole("region",{name:"Data Window",exact:true});
  const row=(id:string,destination:string)=>page.locator(`[data-pine-plot-id="${id}"][data-pine-destination="${destination}"]`);
  const ids=initial.plots.map((plot:any)=>plot.id);
  await data.locator("summary").filter({hasText:"Indicator values"}).click();
  await expect(data.locator(`[data-pine-plot-id="${ids[0]}"] strong`)).toBeVisible();
  await chart(page,590);
  await expect(row(ids[0],"status_line").locator("strong")).toHaveText(price(feed.history[590].close*2,3));
  await expect(data.locator(`[data-pine-plot-id="${ids[0]}"] strong`)).toHaveText(price(feed.history[590].close*2,3));
  await expect(data.locator(`[data-pine-plot-id="${ids[1]}"] strong`)).toHaveText(price(feed.history[590].close+1,3));
  await expect(row(ids[2],"status_line").locator("strong")).toHaveText("—");
  await expect(row(ids[3],"status_line").locator("strong")).toHaveText("1.000");
  await expect(data.locator(`[data-pine-plot-id="${ids[4]}"] strong`)).toHaveText(["open","high","low","close"].map(key=>price((feed.history[590] as any)[key],3)));
  for(const id of [ids[1],ids[4],ids[5],ids[6]])await expect(row(id,"status_line")).toHaveCount(0);
  for(const id of [ids[5],ids[6]])await expect(row(id,"data_window")).toHaveCount(0);
  await chart(page,589);await expect(row(ids[2],"status_line").locator("strong")).toHaveText(price(feed.history[589].close,3));
  await expect(row(ids[3],"status_line").locator("strong")).toHaveText("0.000");
  // Actual mouse movement at public LWC candle coordinates drives the subscribed store; mobile is a disclosed hybrid mouse probe.
  await chart(page,undefined,false,true);await expect(row(ids[0],"status_line").locator("strong")).toHaveText(price(current.close*2,3));
  await row(ids[0],"status_line").click();const controls=page.getByRole("group",{name:"Indicator settings",exact:true});
  await controls.getByLabel("Multiplier",{exact:true}).fill("3");await controls.getByLabel("Multiplier",{exact:true}).press("Enter");
  await expect.poll(async()=>(await runs(page,appSource)).some(result=>result.sessionId&&result.inputs.in_0===3&&result.audit.bars===601)).toBe(true);
  await page.getByRole("button",{name:"Close indicator settings",exact:true}).click();await chart(page,590);
  await expect(row(ids[0],"status_line").locator("strong")).toHaveText(price(feed.history[590].close*3,3));
  const paneSource='//@version=6\nindicator("Native destinations187",overlay=false,format=format.price,precision=2)\nplot(close*2,"Pane status",display=display.all)';
  const paneEditor=await editor(page);await paneEditor.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");
  await paneEditor.getByLabel("EdgeLab indicator source",{exact:true}).fill(paneSource);await paneEditor.getByRole("button",{name:"Check script",exact:true}).click();
  await expect(paneEditor.getByRole("button",{name:"Add to chart",exact:true})).toBeEnabled();await paneEditor.getByRole("button",{name:"Add to chart",exact:true}).click();
  await paneEditor.getByRole("button",{name:"Close indicator editor",exact:true}).click();
  await expect.poll(async()=>(await runs(page,paneSource)).some(result=>result.sessionId&&result.audit.bars===601)).toBe(true);
  const paneResult=(await runs(page,paneSource)).filter(result=>result.sessionId).at(-1)!;
  const pane=page.getByRole("region",{name:"Native destinations187 native Pine pane",exact:true});await expect(pane.locator("canvas").first()).toBeVisible();
  await expect(pane.locator("summary")).toHaveText("Plots");await chart(page,590);
  await expect(page.getByRole("button",{name:"Native destinations187 · Pane status",exact:true}).locator("strong")).toHaveText(price(feed.history[590].close*2,2));
  await expect(data.locator(`[aria-label="Native destinations187 · Pane status"] strong`)).toHaveText(price(feed.history[590].close*2,2));
  const ownership=await chart(page);expect(ownership.sameOwner).toBe(true);expect(observed.errors).toEqual([]);expect(observed.workers.length).toBeGreaterThan(0);
  expect(feed.storage.get("custom-indicator-scripts.v1")?.some((item:any)=>item.source===appSource)).toBe(true);
  const statusGeometry=()=>page.locator('.chart-stage-header [data-pine-destination="status_line"]').evaluateAll((nodes,mobile)=>{
    const rect=(element:Element)=>{const r=element.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const rows=nodes.map(node=>({label:node.getAttribute("aria-label"),box:rect(node),header:rect(node.closest(".chart-stage-header")!),rowWidth:node.closest(".chart-study-row")!.clientWidth,numbers:[...node.querySelectorAll("strong")].map(rect)}));
    const inside=(a:any,b:any)=>a.width>0&&a.height>0&&a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;
    const overlaps=(a:any,b:any)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
    return{rows,valid:rows.length===4&&rows.every(row=>(mobile?row.box.width<=row.rowWidth+1:inside(row.box,row.header))&&row.numbers.every(number=>inside(number,row.box)))&&rows.every((row,i)=>rows.every((other,j)=>i===j||!overlaps(row.box,other.box)))};
  },info.project.name==="mobile");
  await expect.poll(async()=>(await statusGeometry()).valid,"Native status controls do not overlap and numeric groups stay inside their controls").toBe(true);
  const revealed=[];
  if(info.project.name==="mobile")for(const {label} of (await statusGeometry()).rows){
    const button=page.getByRole("button",{name:label!,exact:true});await button.scrollIntoViewIfNeeded();
    const current=(await statusGeometry()).rows.find(row=>row.label===label)!;
    expect(current.box.left).toBeGreaterThanOrEqual(current.header.left-1);expect(current.box.right).toBeLessThanOrEqual(current.header.right+1);
    expect(current.box.top).toBeGreaterThanOrEqual(current.header.top-1);expect(current.box.bottom).toBeLessThanOrEqual(current.header.bottom+1);
    revealed.push(current);
  }
  const geometry={...await statusGeometry(),revealed};
  // Preserve the compact horizontal status strip; capture its final fully revealed native group at an actual owned candle.
  await chart(page,590);await data.scrollIntoViewIfNeeded();
  await save(page,info,before,"actual-hovered-readouts",{scope:"Actual production editor/chart/worker; controlled auth and OHLC provider only; actual browser mouse hover at public LWC candle coordinates (mobile hybrid probe)",initial,paneResult,current,ownership,geometry,providerEvents:feed.events,...observed});
});


// This isolated probe imports real production chart modules in memory and serves
// the frozen production worker bytes. It is component/runtime proof, not an app UI substitute.
const canvasFixture=`
import {createChart} from "./frontend/node_modules/lightweight-charts";
import {createPineRuntimeJob} from "./frontend/src/lib/pineRuntime";
import {adaptPineChartResult,installPineChartPlots} from "./frontend/src/lib/pineChartAdapter";
const origin=1704067200,bars=Array.from({length:32},(_,i)=>({time:origin+i*60,open:99,high:105,low:95,close:100,volume:10}));
const context={symbol:"BINANCE:BTCUSDT",timeframe:"1",mintick:.01,pointvalue:1};
let chart,base,installed,result,adapted;
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function pixels(){const element=document.querySelector("#chart"),rect=element.getBoundingClientRect(),canvas=document.createElement("canvas");canvas.width=Math.round(rect.width);canvas.height=Math.round(rect.height);const ctx=canvas.getContext("2d");
 for(const layer of element.querySelectorAll("canvas")){const r=layer.getBoundingClientRect();ctx.drawImage(layer,r.left-rect.left,r.top-rect.top,r.width,r.height);}
 const data=ctx.getImageData(0,0,canvas.width,canvas.height).data,pane=chart.paneSize();let red=0,cyan=0,axisCyan=0,axisMinY=Infinity,axisMaxY=-Infinity;
 for(let y=0;y<Math.floor(pane.height);y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
  if(x<pane.width&&r>150&&r>g*1.5&&r>b*1.5)red++;
  if(g>150&&b>150&&r<80){if(x<pane.width)cyan++;else{axisCyan++;axisMinY=Math.min(axisMinY,y);axisMaxY=Math.max(axisMaxY,y);}}}
 return{red,cyan,axisCyan,axisMinY:Number.isFinite(axisMinY)?axisMinY:null,axisMaxY:Number.isFinite(axisMaxY)?axisMaxY:null};}
export async function run(source){installed?.dispose();chart?.remove();const element=document.querySelector("#chart");element.replaceChildren();
 chart=createChart(element,{width:element.clientWidth,height:350,layout:{background:{color:"#111827"},textColor:"#e2e8f0"},grid:{vertLines:{visible:false},horzLines:{visible:false}},
  crosshair:{vertLine:{visible:false},horzLine:{visible:false}},rightPriceScale:{borderVisible:false},timeScale:{borderVisible:false}});
 base=chart.addCandlestickSeries({upColor:"#475569",downColor:"#475569",wickUpColor:"#475569",wickDownColor:"#475569",borderVisible:false,lastValueVisible:false,priceLineVisible:false});base.setData(bars);chart.timeScale().setVisibleLogicalRange({from:4,to:25});await paint();
 const before={coordinates:[95,100,105].map(p=>base.priceToCoordinate(p)),range:chart.timeScale().getVisibleLogicalRange(),ink:pixels()};
 result=await createPineRuntimeJob({action:"run",mode:"historical",source,bars,inputs:{},context}).promise;adapted=adaptPineChartResult(result,bars);
 installed=installPineChartPlots(chart,adapted.plots,"right",{readouts:adapted.readouts,allowFillOnlyScale:false});await paint();return{before,after:summary()};}
export function summary(){return{coordinates:[95,100,105].map(p=>base.priceToCoordinate(p)),range:chart.timeScale().getVisibleLogicalRange(),ink:pixels(),labelY:base.priceToCoordinate(100),
 result:result.plots.map(p=>({id:p.id,name:p.name,options:p.options})),plots:adapted.plots.map(p=>({id:p.id,name:p.name,kind:p.kind})),
 readouts:adapted.readouts.map(r=>({id:r.id,name:r.name,destinations:r.destinations})),series:installed.series.map(s=>({data:s.data(),options:s.options()}))};}
export async function pan(from,to){chart.timeScale().setVisibleLogicalRange({from,to});await paint();return summary();}
export async function dispose(){installed.dispose();installed.dispose();await paint();return{ink:pixels(),coordinates:[95,100,105].map(p=>base.priceToCoordinate(p)),range:chart.timeScale().getVisibleLogicalRange()};}
`;
async function isolated(page:Page) {
  const assets=path.resolve("frontend/dist/assets"),worker=fs.readdirSync(assets).find(name=>/^pine-native-worker.*\.js$/.test(name))!;
  const fixture=(await build({bundle:true,write:false,platform:"browser",format:"iife",globalName:"displayFixture187",logLevel:"silent",
    stdin:{contents:canvasFixture,loader:"ts",resolveDir:process.cwd(),sourcefile:"display187-canvas.ts"},plugins:[{name:"sealed-worker-url",setup(builder){
      builder.onResolve({filter:/^virtual:pine-worker-url$/},()=>({path:"worker",namespace:"display187"}));builder.onLoad({filter:/.*/,namespace:"display187"},()=>({contents:"export default "+JSON.stringify("/assets/"+worker),loader:"js"}));}}]})).outputFiles[0].text;
  await page.route("**/display187-fixture.js",route=>route.fulfill({contentType:"text/javascript",body:fixture}));
  await page.route("**/display187-fixture",route=>route.fulfill({contentType:"text/html",body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#111827;color:white}#chart{width:100%}</style><p>Actual LWC display integration</p><div id="chart"></div><script src="/display187-fixture.js"></script>'}));
  await page.goto("/display187-fixture");return{fixtureSha256:hash(fixture),worker};
}
test("actual LWC keeps hidden destinations off pane pixels/autoscale while visible fills and owned axis labels retain exact placement",async({page},info)=>{
  const before=seal(),observed=await observe(page),binding=await isolated(page);
  const run=(body:string)=>page.evaluate(source=>(window as any).displayFixture187.run(source),'//@version=6\nindicator("Canvas destinations187",overlay=true)\n'+body);
  const hidden=await run('plot(1000000,"Hidden",display=display.none,color=#ff0000)\nplot(2000000,"Data",display=display.data_window,color=#ff0000)\nplot(3000000,"Status",display=display.status_line,color=#ff0000)');
  expect(hidden.after.plots).toEqual([]);expect(hidden.after.series).toEqual([]);expect(hidden.after.coordinates).toEqual(hidden.before.coordinates);
  expect(hidden.after.range).toEqual(hidden.before.range);expect(hidden.after.ink.red).toBe(0);expect(hidden.after.ink.cyan).toBe(0);
  const fill=await run('a=plot(99,"Lower",display=display.none)\nb=plot(102,"Upper",display=display.none)\nfill(a,b,color=#ff0000)');
  expect(fill.after.plots.map((plot:any)=>plot.kind)).toEqual(["fill"]);expect(fill.after.ink.red).toBeGreaterThan(100);
  const axis=await run('plot(100,"Scale only",display=display.price_scale,color=#00ffff,offset=100,precision=3)');
  expect(axis.after.plots).toEqual([]);expect(axis.after.coordinates).toEqual(axis.before.coordinates);
  expect(axis.after.ink.cyan).toBe(0);expect(axis.after.ink.axisCyan).toBeGreaterThan(10);
  expect(axis.after.ink.axisMinY).toBeLessThanOrEqual(axis.after.labelY);expect(axis.after.ink.axisMaxY).toBeGreaterThanOrEqual(axis.after.labelY);
  const label=axis.after.series.find((series:any)=>series.options.lastValueVisible);expect(label.data).toHaveLength(1);
  expect(label.data[0]).toEqual({time:1704067200+25*60,value:100});expect(label.options.priceLineVisible).toBe(false);
  const moved=await page.evaluate(()=>(window as any).displayFixture187.pan(4,15));
  expect(moved.series.find((series:any)=>series.options.lastValueVisible).data[0]).toEqual({time:1704067200+15*60,value:100});
  const removed=await page.evaluate(()=>(window as any).displayFixture187.dispose());expect(removed.ink.axisCyan).toBe(0);
  expect(observed.errors).toEqual([]);expect(observed.workers.length).toBeGreaterThan(0);
  await save(page,info,before,"canvas-destination-pixels",{scope:"Isolated actual chart/adapter/runtime, frozen production worker; no app navigation substituted",binding,hidden,fill,axis,moved,removed,...observed});
});
