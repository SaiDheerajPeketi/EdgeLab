import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {createHash} from "node:crypto";
import {build} from "esbuild";
import {test as base,expect,type Page,type Locator} from "@playwright/test";
import {betaSessionResponse,FROZEN_TIME,gotoStable} from "./support/app";
import {fulfillReplayContext,prepare,bars as productBars} from "./support/replay-context";
import type {PineExecutionResult} from "../frontend/src/lib/pineProtocol";

const bytes=fs.readFileSync(path.resolve("e2e/pine-visuals.bars.json"));
expect(createHash("sha256").update(bytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars=JSON.parse(bytes.toString()),artifacts=path.resolve(".artifacts/pine-barcolor43/browser");
type Receipt={operation_id:string;method:string;path:string;status:"reserved"|"completed";http_status:number|null;result:null;created_at:string;completed_at:string|null};
// A genuine opaque worker executes the exact source. Only consumer-side observations are instrumented.
const fixtureSource=String.raw`
import {createChart} from "../frontend/node_modules/lightweight-charts";
import {createPineRuntimeJob} from "../frontend/src/lib/pineRuntime";
import {adaptPineChartResult,installPineChartPlots,latestPineChartPoint,projectPineBarColors} from "../frontend/src/lib/pineChartAdapter";
import {getPackedPinePlot,pointAtBar} from "../frontend/src/lib/pinePacked";
let state;
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const colors={upColor:"#22c55e",downColor:"#eab308",borderUpColor:"#3b82f6",borderDownColor:"#ec4899",wickUpColor:"#c084fc",wickDownColor:"#f97316"};
export async function run(input){
 if(state){state.installed.dispose();state.chart.remove();}const element=document.querySelector("#chart");element.replaceChildren();
 const result=await createPineRuntimeJob({action:"run",source:input.source,bars:input.bars,inputs:input.inputs??{},context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1},mode:"historical"}).promise;
 const adapted=adaptPineChartResult(result,input.bars),chart=createChart(element,{width:element.clientWidth,height:240,layout:{background:{color:"#111827"},textColor:"#cbd5e1"},grid:{vertLines:{visible:false},horzLines:{visible:false}},rightPriceScale:{borderVisible:false},timeScale:{visible:false},crosshair:{vertLine:{visible:false},horzLine:{visible:false}}});
 const originals=(input.chartBars??input.bars).map((bar,index)=>({time:bar.time,open:index%2?110:90,close:index%2?90:110,high:120,low:80,color:index%2?colors.downColor:colors.upColor,borderColor:index%2?colors.borderDownColor:colors.borderUpColor,wickColor:index%2?colors.wickDownColor:colors.wickUpColor}));
 const primary=chart.addCandlestickSeries({...colors,borderVisible:true,wickVisible:true,lastValueVisible:true,priceLineVisible:false,autoscaleInfoProvider:()=>({priceRange:{minValue:75,maxValue:125}})});
 primary.setData(originals);chart.timeScale().setVisibleLogicalRange({from:input.from??120,to:input.to??144});await paint();const before=primary.priceToCoordinate(100);
 const views=result.plots.map(getPackedPinePlot),buffers=views.flatMap(v=>v?[v.values.buffer,v.kinds.buffer,v.optionIndices.buffer]:[]),copies=buffers.map(b=>new Uint8Array(b).slice());let reads=0;
 const nativeSamples=result.plots.map((plot,i)=>[0,1,128,254,255,input.bars.length-1].filter(n=>n<input.bars.length).map(n=>({index:n,point:views[i]?pointAtBar(plot,n):plot.points.find(p=>p.time===input.bars[n].time)})));
 if(input.instrument)for(const plot of result.plots){const points=plot.points;Object.defineProperty(plot,"points",{get(){reads++;return points;},configurable:true});}
 const projection=projectPineBarColors(adapted.plots,input.chartBars??input.bars),baselineReads=reads;
 const installed=installPineChartPlots(chart,adapted.plots);
 state={result,adapted,chart,primary,element,originals,originalJSON:JSON.stringify(originals),projection,installed,views,buffers,copies,nativeSamples,baselineReads,readCount:()=>reads,before,input};
 await apply(true);return summary();
}
export async function apply(active){state.primary.setData(state.originals.map((bar,index)=>{const color=active?state.projection.colorAt(index):undefined;return color===undefined?{...bar}:{...bar,color};}));await paint();return summary();}
export function summary(){
 return {engine:state.result.audit.engineVersion,source:state.result.source,inputs:state.result.inputs,plots:state.result.plots.map((p,i)=>({name:p.name,style:p.style,options:p.options,packed:!!state.views[i],samples:state.nativeSamples[i]})),
 drawn:state.adapted.plots.map(p=>({kind:p.kind,overlay:p.overlay,latest:latestPineChartPoint(p)})),warnings:state.adapted.adapterWarnings,series:state.installed.series.length,primitive:!!state.installed.primitive,
 before:state.before,after:state.primary.priceToCoordinate(100),visible:state.chart.timeScale().getVisibleLogicalRange(),originalUnchanged:JSON.stringify(state.originals)===state.originalJSON,options:Object.fromEntries(Object.keys(colors).map(k=>[k,state.primary.options()[k]])),
 packed:{buffers:new Set(state.buffers).size,bytes:state.buffers.reduce((n,b)=>n+b.byteLength,0),intact:state.buffers.every((b,i)=>b.byteLength===state.copies[i].length&&new Uint8Array(b).every((v,j)=>v===state.copies[i][j])),queryPointReads:state.readCount()-state.baselineReads}};
}
function image(){const rect=state.element.getBoundingClientRect(),ratio=devicePixelRatio||1,c=document.createElement("canvas");c.width=Math.round(rect.width*ratio);c.height=Math.round(rect.height*ratio);const ctx=c.getContext("2d");for(const layer of state.element.querySelectorAll("canvas")){const r=layer.getBoundingClientRect();ctx.drawImage(layer,(r.left-rect.left)*ratio,(r.top-rect.top)*ratio,r.width*ratio,r.height*ratio);}return{width:c.width,height:c.height,ratio,pixels:ctx.getImageData(0,0,c.width,c.height).data};}
export function probe(index){
 const b=state.originals[index],x=state.chart.timeScale().timeToCoordinate(b.time),y=state.primary.priceToCoordinate(100),wy=state.primary.priceToCoordinate(115),size=state.chart.paneSize();
 if(x===null||y===null||x<0||x>=size.width||y<0||y>=size.height)throw new Error("Candle outside pane "+JSON.stringify({index,x,y,size,visible:state.chart.timeScale().getVisibleLogicalRange()}));
 const data=image(),cx=Math.round(x*data.ratio),cy=Math.round(y*data.ratio),rgb=(xx,yy)=>Array.from(data.pixels.slice((yy*data.width+xx)*4,(yy*data.width+xx)*4+3));
 const slot=Math.abs(state.chart.timeScale().logicalToCoordinate(index+1)-x),border=[],wick=[];
 for(let dx=-Math.floor(slot*data.ratio*.48);dx<=Math.floor(slot*data.ratio*.48);dx++)if(cx+dx>=0&&cx+dx<data.width)border.push(rgb(cx+dx,cy));
 for(let dx=-2*data.ratio;dx<=2*data.ratio;dx++)wick.push(rgb(cx+dx,Math.round(wy*data.ratio)));
 return{index,x,y,dpr:data.ratio,rgb:rgb(cx,cy),border,wick,original:b,visible:state.chart.timeScale().getVisibleLogicalRange()};
}
export async function pan(from,to){state.chart.timeScale().setVisibleLogicalRange({from,to});await paint();return summary();}
export async function resize(){state.chart.resize(state.element.clientWidth,180);await paint();return summary();}
export async function dispose(){state.installed.dispose();state.installed.dispose();return apply(false);}
`;
type Harness = { origin: string; workerRequests: string[]; otherRequests: string[]; workerSha256: string };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const assets = path.resolve("frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Root must freeze/build production first");
    const workerPath = "/assets/" + workerName, worker = fs.readFileSync(path.join(assets, workerName));
    const compiled = await build({ stdin: { contents: fixtureSource, resolveDir: path.resolve("e2e"), loader: "ts", sourcefile: "barcolor-proof.ts" }, bundle: true, write: false, platform: "browser", format: "iife", globalName: "barcolorFixture",
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "actual-worker" }));
        builder.onLoad({ filter: /.*/, namespace: "actual-worker" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
      } }] });
    const workerRequests: string[] = [], otherRequests: string[] = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname; response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pine numeric plots</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}h1{font-size:20px}#chart{width:100%}</style><h1>Native Pine candle bodies · actual chart canvas</h1><div id="chart"></div><script src="/fixture.js"></script>'); }
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

const program=(body:string)=>'//@version=6\nindicator("Candle body proof",overlay=false)\n'+body;
async function native(page:Page,source:string,options:any={}){
 const result=await page.evaluate(input=>(window as any).barcolorFixture.run(input),{source,bars,...options});
 expect(result.engine).toBe("0.11.0");expect(result.source).toBe(source);expect(result.series).toBe(0);expect(result.primitive).toBe(false);expect(result.before).toBe(result.after);expect(result.originalUnchanged).toBe(true);
 for(const p of result.drawn)expect(p).toMatchObject({kind:"barcolor",overlay:true,latest:null});
 await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);return result;
}
const probe=(page:Page,index:number)=>page.evaluate(index=>(window as any).barcolorFixture.probe(index),index);
const hex=(value:string)=>[1,3,5].map(n=>parseInt(value.slice(n,n+2),16));
const rgba=(color:number[],alpha=1)=>[17,24,39].map((v,i)=>Math.round(color[i]*alpha+v*(1-alpha)));
function rgb(actual:number[],expected:number[],label:string){for(let i=0;i<3;i++)expect(Math.abs(actual[i]-expected[i]),label+" channel "+i).toBeLessThanOrEqual(2);}
function originalEdges(actual:any){
 for(const [name,color] of [["border",actual.original.borderColor],["wick",actual.original.wickColor]] as const)
  expect(actual[name].some((p:number[])=>p.every((v,i)=>Math.abs(v-hex(color)[i])<=2)),name+" retains directional original RGB").toBe(true);
}
async function capture(page:Page,name:string,project:string,result:any,harness?:Harness){
 fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,name+"-"+project+".png")});
 fs.writeFileSync(path.join(artifacts,name+"-"+project+".json"),JSON.stringify({workerSha256:harness?.workerSha256,result},null,2));
}
test("native dynamic colors affect body only while na and transparent retain distinct meanings",async({page,harness},info)=>{
 const source=program('barcolor(bar_index%4==0?#ff0000:bar_index%4==1?na:bar_index%4==2?#ff000000:#ff000080,title="Body only")');
 const result=await native(page,source);
 for(const [index,expected] of [[128,[255,0,0]],[129,hex("#eab308")],[130,[17,24,39]],[131,rgba([255,0,0],128/255)]] as const){
  const actual=await probe(page,index);rgb(actual.rgb,[...expected],"native body "+index);originalEdges(actual);
 }
 expect(result.plots[0].options).toMatchObject({offset:0,editable:true,display:"all"});
 expect(result.plots[0].samples.find((s:any)=>s.index===128).point).toMatchObject({time:bars[128].time,value:true,options:{color:"#ff0000"}});
 await capture(page,"body-na-transparent",info.project.name,result,harness);expect(harness.workerRequests).toHaveLength(1);
});
test("six positional and named flags custom reruns and display none preserve source metadata",async({page,harness},info)=>{
 for(const positional of [false,true])for(const [offset,shade] of [[3,"#ff0000"],[-3,"#0000ff"]] as const){
  const source=program('shift=input.int(3,"Shift")\nshade=input.color(#ff0000,"Shade")\n'+(positional?'barcolor(shade,shift,false,128,"Six flags",display.all)':'barcolor(shade,offset=shift,editable=false,show_last=128,title="Six flags",display=display.all)'));
  const result=await native(page,source,{inputs:{in_0:offset,in_1:shade}});
  expect(result.inputs).toEqual({in_0:offset,in_1:shade});expect(result.plots[0].options).toMatchObject({offset,editable:false,show_last:128,display:"all"});
  const actual=await probe(page,130+offset);rgb(actual.rgb,hex(shade),"input shifted body");originalEdges(actual);
  rgb((await probe(page,127+offset)).rgb,hex((127+offset)%2?"#eab308":"#22c55e"),"source cutoff precedes offset");
  await capture(page,(positional?"positional":"named")+"-"+offset,info.project.name,result,harness);
 }
 const hidden=await native(page,program('barcolor(#ff0000,0,false,128,"Hidden",display.none)'));
 expect(hidden.drawn).toEqual([]);rgb((await probe(page,128)).rgb,hex("#22c55e"),"display none");
 await capture(page,"display-none",info.project.name,hidden,harness);
});
test("percentage fractional and tiny alpha colors keep actual last price labels paintable",async({page,harness},info)=>{
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 for(const [color,expected] of [["rgb(100%,0%,0%)",[255,0,0]],["rgba(255.5,0.2,0.1,0.5)",rgba([255,0,0],.5)],["rgba(255,0,0,0.00000001)",rgba([255,0,0],.000001)]] as const){
  const result=await native(page,program('barcolor("'+color+'",title="CSS color")'),{from:240,to:258});
  const actual=await probe(page,255);rgb(actual.rgb,[...expected],"CSS body and visible price-label contrast parser");originalEdges(actual);
  expect(result.plots[0].samples.at(-1).point.options.color).toBe(color);
  await capture(page,"css-"+color.replace(/\W/g,""),info.project.name,result,harness);
 }
 expect(errors).toEqual([]);
});
test("sparse primary timeline offsets use shared slots and source show_last before shifting",async({page,harness},info)=>{
 const primary:any[]=[];for(let i=0;i<20;i++)primary.push({...bars[0],time:bars[0].time-60*(20-i)});
 for(const bar of bars)for(const seconds of [0,1,2])primary.push({...bar,time:bar.time+seconds});
 for(const offset of [5,-5]){
  const source=program('barcolor(bar_index=='+(offset>0?255:0)+'?#ff0000:na,offset='+offset+',show_last='+(offset>0?1:256)+',title="Sparse offset")');
  const sourceIndex=offset>0?255:0,target=20+sourceIndex*3+offset;
  // Extra genuine primary time slots, not synthetic candles created by the projection.
  if(offset>0)for(let i=1;i<=8;i++)primary.push({...bars.at(-1),time:bars.at(-1).time+2+i});
  const result=await native(page,source,{chartBars:primary,from:target-5,to:target+7});
  const actual=await probe(page,target);rgb(actual.rgb,[255,0,0],"shared logical target");originalEdges(actual);
  rgb((await probe(page,target+1)).rgb,hex((target+1)%2?"#eab308":"#22c55e"),"adjacent slot untouched");
  await capture(page,offset>0?"sparse-future":"sparse-past",info.project.name,{...result,actual,sourceIndex,target},harness);
 }
});
test("packed 20k retains three owned buffers and queries typed views without point projection",async({page,harness},info)=>{
 const history=Array.from({length:20000},(_,i)=>({...bars[i%256],time:bars[0].time+i*60}));
 const source=program('barcolor(bar_index%2==0?#ff0000:#0000ff,title="Packed body")');
 let result=await native(page,source,{bars:history,from:10000,to:10024,instrument:true});
 expect(result.packed).toEqual({buffers:3,bytes:220000,intact:true,queryPointReads:0});
 for(const index of [10012,10013])rgb((await probe(page,index)).rgb,index%2?[0,0,255]:[255,0,0],"packed body");
 await capture(page,"packed-20k",info.project.name,result,harness);
 result=await page.evaluate(()=>(window as any).barcolorFixture.pan(15000,15024));expect(result.packed.queryPointReads).toBe(0);
 result=await page.evaluate(()=>(window as any).barcolorFixture.resize());expect(result.packed.queryPointReads).toBe(0);expect(result.packed.intact).toBe(true);
 originalEdges(await probe(page,15012));rgb((await probe(page,15012)).rgb,[255,0,0],"packed pan resize");
 result=await page.evaluate(()=>(window as any).barcolorFixture.dispose());expect(result.packed.intact).toBe(true);expect(result.packed.queryPointReads).toBe(0);
 rgb((await probe(page,15012)).rgb,hex("#22c55e"),"dispose body restoration");await capture(page,"packed-restored",info.project.name,result,harness);
});

async function fixture(page: Page) {
  const workerReceipts:Array<{url:string;sha256:string;bytes:number}>=[];
  page.on("response",async response=>{if(/\/assets\/pine-native-worker[^/]*\.js$/.test(new URL(response.url()).pathname)){const body=await response.body();workerReceipts.push({url:response.url(),sha256:createHash("sha256").update(body).digest("hex"),bytes:body.length});}});
  await prepare(page);
  await fulfillReplayContext(page);
  const storage = new Map<string, unknown>();
  const receipts = new Map<string, Receipt>();
  const writes: Array<{ key: string; value: unknown }> = [];
  const identity = { token: betaSessionResponse.token, owner: 7001 };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/session") {
      await route.fulfill({ json: { ...betaSessionResponse, token: identity.token, user: { ...betaSessionResponse.user, id: identity.owner } } });
      return;
    }
    const metadata = endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (metadata) {
      expect(request.headers().authorization).toBe(`Bearer ${identity.token}`);
      const [, id, action] = metadata;
      if (action === "reserve") receipts.set(id, { operation_id: id, ...request.postDataJSON(), status: "reserved", http_status: null, result: null, created_at: "2026-09-15T10:00:00Z", completed_at: null });
      expect(receipts.has(id)).toBe(true);
      await route.fulfill({ json: receipts.get(id) });
      return;
    }
    const bound = request.headers()["x-edgelab-operation-id"];
    if (bound) {
      expect(receipts.get(bound)).toMatchObject({ method: request.method(), path: endpoint, status: "reserved" });
      Object.assign(receipts.get(bound)!, { status: "completed", http_status: 200, completed_at: "2026-09-15T10:00:01Z" });
    }
    const key = endpoint.match(/^\/app-storage\/edgelab\/(.+)$/)?.[1];
    if (key) {
      const decoded = decodeURIComponent(key);
      if (request.method() === "PUT") { storage.set(decoded, request.postDataJSON().value); writes.push({ key: decoded, value: structuredClone(storage.get(decoded)) }); }
      await route.fulfill({ json: { namespace: "edgelab", key: decoded, value: storage.get(decoded) ?? null, updated_at: FROZEN_TIME } });
      return;
    }
    await route.fallback();
  });
  // Observe genuine opaque-frame results. No worker, engine or result is replaced.
  await page.addInitScript(() => {
    (window as any).__nativeEditorResults = [];
    addEventListener("message", (event) => {
      const actual = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find((frame) => frame.contentWindow === event.source && frame.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (actual && event.origin === "null" && event.data?.type === "result") {
        (window as any).__nativeEditorResults.push(event.data.payload);
        if (event.data.payload?.status === "completed" && event.data.payload.result?.kind === "run" && event.data.payload.result.source === (window as any).__barcolorHoldSource && !(window as any).__barcolorReleasing) {
          (window as any).__barcolorHeld = event;
          event.stopImmediatePropagation();
        }
      }
    }, true);
  });
  await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  return { storage, writes, identity,workerReceipts };
}

async function openEditor(page: Page) {
  const trigger = page.getByRole("button", { name: "Editor", exact: true });
  if (!await trigger.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await trigger.click();
  const editor = page.getByRole("dialog", { name: "EdgeLab indicator editor" });
  await expect(editor).toBeVisible();
  return editor;
}

async function fillSource(editor: Locator, source: string) {
  await editor.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
}

async function check(editor: Locator) {
  await editor.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
}

async function run(editor: Locator) {
  await editor.getByRole("button", { name: "Run", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
  await expect(editor.locator("#edge-editor-diagnostics")).toContainText(/PineTS|Pine/);
}

async function nativeRun(page: Page, source: string) {
  await expect.poll(() => page.evaluate((expected) => (window as any).__nativeEditorResults.filter((item) => item.status === "completed" && item.result.kind === "run" && item.result.source === expected).length, source)).toBeGreaterThan(0);
  return page.evaluate((expected) => {
    const found = [...(window as any).__nativeEditorResults].reverse().find((item) => item.status === "completed" && item.result.kind === "run" && item.result.source === expected);
    return found?.status === "completed" ? found.result as PineExecutionResult : null;
  }, source).then((result) => { expect(result).not.toBeNull(); return result!; });
}



async function activate(page:Page,control:Locator,touch:boolean){await control.scrollIntoViewIfNeeded();if(touch)await control.tap();else await control.click();}
async function chartBitmap(page:Page){
 // Hash only the base canvases; observing them must not mutate genuine touch/hover state.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 return page.locator(".chart-stage").first().evaluate(async (stage,times)=>{
  const nodes=[...stage.querySelectorAll<HTMLCanvasElement>("canvas")],main=nodes.filter(c=>c.getBoundingClientRect().height>80).sort((a,b)=>b.width-a.width)[0];
  const axis=nodes.find(c=>{const r=c.getBoundingClientRect();return r.width>100&&r.height>10&&r.height<80;});
  if(!main||!axis)throw new Error("Real primary/time-axis canvas unavailable");
  const hash=async(c:HTMLCanvasElement)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",c.getContext("2d")!.getImageData(0,0,c.width,c.height).data))).map(v=>v.toString(16).padStart(2,"0")).join("");
  const data=main.getContext("2d")!.getImageData(0,0,main.width,main.height).data;let red=0,blue=0;
  for(let i=0;i<data.length;i+=4){if(data[i]===255&&data[i+1]===0&&data[i+2]===0)red++;if(data[i]===0&&data[i+1]===0&&data[i+2]===255)blue++;}
  const fiberKey=Object.keys(stage).find(k=>k.startsWith("__reactFiber"));let api:any=null;
  for(let fiber=fiberKey?(stage as any)[fiberKey]:null,depth=0;fiber&&depth<64&&!api;fiber=fiber.return,depth++){
   for(let hook=fiber.memoizedState,count=0;hook&&count<256;hook=hook.next,count++){
    const ref=hook.memoizedState?.current;if(ref&&typeof ref.timeScale==="function"&&typeof ref.addCandlestickSeries==="function"){api=ref;break;}
   }
  }
  const chartAudit=api?{visible:api.timeScale().getVisibleLogicalRange(),pane:api.paneSize(),timeOptions:api.timeScale().options(),anchors:times.map((time:number)=>({time,x:api.timeScale().timeToCoordinate(time)}))}:null;
  return{chartAudit,scroll:{x:scrollX,y:scrollY},primary:await hash(main),axis:await hash(axis),width:main.width,height:main.height,red,blue,canvases:nodes.map(c=>{const r=c.getBoundingClientRect();return{width:c.width,height:c.height,x:r.x,y:r.y,cssWidth:r.width,cssHeight:r.height};})};
 },[productBars[0].time,productBars[24].time,productBars[48].time,productBars[72].time,productBars[96].time]);
}
test("saved genuine barcolor studies preserve panned candles through reversed completion inputs Hide Show Remove",async({page},info)=>{
 test.setTimeout(120000);const pageErrors:string[]=[];page.on("pageerror",error=>pageErrors.push(error.message));const touch=!!(info.project.use.hasTouch||info.project.use.isMobile),context=await fixture(page),originalBars=JSON.stringify(productBars);
 const sources=[program('shade=input.color(#ff0000,"Shade")\nbarcolor(shade,title="First red")').replace("Candle body proof","First body study"),
 program('shade=input.color(#0000ff,"Shade")\nbarcolor(shade,title="Later blue")').replace("Candle body proof","Later body study")];
 for(const source of sources){
  const editor=await openEditor(page);await editor.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");await fillSource(editor,source);await check(editor);await run(editor);
  const result=await nativeRun(page,source);expect(result.audit.engineVersion).toBe("0.11.0");expect(result.plots[0].style).toBe("barcolor");
  await editor.getByRole("button",{name:"Save",exact:true}).click();
  await expect.poll(()=>((context.storage.get("custom-indicator-scripts.v1") as any[])??[]).some(s=>s.source===source)).toBe(true);
  await editor.getByRole("button",{name:"Close indicator editor",exact:true}).click();
 }
 const savedScripts=structuredClone(context.storage.get("custom-indicator-scripts.v1") as any[]);
 await page.reload();await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
 for(const [index,source] of sources.entries()){
  const editor=await openEditor(page);await editor.getByLabel("Script library",{exact:true}).selectOption(savedScripts.find(s=>s.source===source).id);
  await expect(editor.getByLabel("EdgeLab indicator source",{exact:true})).toHaveValue(source);await check(editor);await run(editor);
  // Hold only the first-study result belonging to the final two-study context, not the cancelled one-study job.
  if(index===1)await page.evaluate(source=>{(window as any).__barcolorHoldSource=source;(window as any).__barcolorHeld=null;},sources[0]);
  await editor.getByRole("button",{name:"Add to chart",exact:true}).click();await editor.getByRole("button",{name:"Close indicator editor",exact:true}).click();
  if(index===0){await expect.poll(()=>chartBitmap(page).then(v=>v.red)).toBeGreaterThan(0);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);}
 }
 await expect.poll(()=>page.evaluate(()=>!!(window as any).__barcolorHeld)).toBe(true);
 await expect.poll(()=>chartBitmap(page).then(v=>v.blue)).toBeGreaterThan(0);
 const reverse=await page.evaluate(()=>{
  const event=(window as any).__barcolorHeld as MessageEvent;if(!event)throw new Error("No authentic held event");
  const actual=[...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(f=>f.contentWindow===event.source&&f.srcdoc.includes('data-job="'+event.data.nonce+'"'));
  if(!actual||event.origin!=="null"||event.data.payload.status!=="completed")throw new Error("Held result identity changed");
  (window as any).__barcolorReleasing=true;(window as any).__barcolorHoldSource=null;
  // Native propagation flags survive redispatch. Preserve genuine fields in a fresh event.
  dispatchEvent(new MessageEvent("message",{data:event.data,source:event.source,origin:event.origin,ports:[...event.ports]}));
  return{source:event.data.payload.result.source,engine:event.data.payload.result.audit.engineVersion,nonce:event.data.nonce};
 });
 expect(reverse.source).toBe(sources[0]);expect(reverse.engine).toBe("0.11.0");
 await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
 await expect(page.locator('.chart-study-pill[data-indicator-id]').filter({hasText:"First body study"})).toBeVisible();
 const pill=page.locator('.chart-study-pill[data-indicator-id]').filter({hasText:"Later body study"}).first();
 await expect(pill).toBeVisible();await expect(pill.locator("strong")).toHaveCount(0);
 await expect(page.getByRole("region",{name:"Later body study native Pine pane",exact:true})).toHaveCount(0);
 await expect.poll(()=>chartBitmap(page).then(v=>v.blue)).toBeGreaterThan(0);
 await activate(page,page.getByRole("button",{name:"Objects",exact:true}).first(),touch);
 const resizeHistory:any[]=[];let resizeAxis="",resizeStable=0;
 await expect.poll(async()=>{const v=await chartBitmap(page);resizeHistory.push(v);resizeStable=v.axis===resizeAxis?resizeStable+1:0;resizeAxis=v.axis;return resizeStable;},{intervals:[100],message:"Objects resize settles before real pan"}).toBeGreaterThanOrEqual(3);
 const beforePan=resizeHistory.at(-1),canvas=page.locator(".chart-stage canvas").first();await canvas.scrollIntoViewIfNeeded();
 const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.55+80,box.y+box.height*.5,{steps:8});await page.mouse.up();
 const panHistory:any[]=[];let priorAxis="",stableAxisReads=0;
 await expect.poll(async()=>{const observed=await chartBitmap(page);panHistory.push(observed);stableAxisReads=observed.axis===priorAxis?stableAxisReads+1:0;priorAxis=observed.axis;return stableAxisReads;},{intervals:[100],message:"Dates settle after real panel resize and pan before any color action"}).toBeGreaterThanOrEqual(3);
 const panned=panHistory.at(-1);expect(panned.axis,"Real manually panned dates change").not.toBe(beforePan.axis);expect(panned.blue).toBeGreaterThan(0);expect(panned.red).toBe(0);
 await capture(page,"product-reversed-panned",info.project.name,{reverse,resizeHistory,beforePan,panHistory,panned,workerReceipts:context.workerReceipts});
 const settings=page.getByRole("group",{name:"Indicator settings",exact:true});
 await activate(page,pill,touch);await settings.getByRole("textbox",{name:"Shade",exact:true}).fill("#ff0000");
 await expect.poll(()=>page.evaluate(source=>(window as any).__nativeEditorResults.some((p:any)=>p.status==="completed"&&p.result.kind==="run"&&p.result.source===source&&p.result.inputs.in_0==="#ff0000"),sources[1])).toBe(true);
 await activate(page,settings.getByRole("button",{name:"Close indicator settings",exact:true}),touch);
 await expect.poll(()=>chartBitmap(page).then(v=>v.red)).toBeGreaterThan(0);
 const edited=await chartBitmap(page);await capture(page,"product-input-diagnostic",info.project.name,{panHistory,panned,edited});expect(edited.axis,"Input rerun preserves panned dates").toBe(panned.axis);expect(edited.blue).toBe(0);
 await activate(page,pill,touch);await activate(page,settings.getByTitle("Hide indicator",{exact:true}),touch);await expect(settings).toBeHidden();
 await expect.poll(()=>chartBitmap(page).then(v=>v.primary),"Settled Hide restores exact earlier-study candle pixels").toBe(edited.primary);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
 const hidden=await chartBitmap(page);expect(hidden.axis,"Hide preserves dates").toBe(panned.axis);expect(hidden.primary,"Earlier red remains after Hide").toBe(edited.primary);
 const row=page.locator(".chart-object-row").filter({hasText:"Later body study"}).first();
 if(touch)await row.locator(".object-symbol-cell").tap();else await row.hover();
 const objectControls=await row.evaluate(r=>{const buttons=[...r.querySelectorAll("button")];return{caption:r.textContent,controls:buttons.map(b=>{const p=b.getBoundingClientRect(),hit=document.elementFromPoint(p.x+p.width/2,p.y+p.height/2);return{text:b.textContent,bounds:{x:p.x,y:p.y,width:p.width,height:p.height},hit:hit?.outerHTML};})};});
 await capture(page,"objects-visibility-controls",info.project.name,objectControls);
 await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
 const openBaseline=await chartBitmap(page);
 const hiddenControl=row.getByRole("button",{name:"Hidden",exact:true});
 if(touch){
  // Locator auto-scrolling dismisses this existing overflowing hover popup. Tap its real, current hit target.
  const hit=await hiddenControl.evaluate(button=>{const r=button.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,target=document.elementFromPoint(x,y);return{x,y,width:r.width,height:r.height,inViewport:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,ownsHit:!!target&&button.contains(target)};});
  expect(hit.inViewport,"Actual Hidden control inside touch viewport").toBe(true);expect(hit.ownsHit,"Actual Hidden button owns touch point").toBe(true);
  await page.touchscreen.tap(hit.x,hit.y);
 }else await hiddenControl.click();
 await expect(pill).toBeVisible();await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
 await expect.poll(()=>chartBitmap(page).then(v=>v.primary),"Show preserves exact candle pixels in unchanged drawer geometry").toBe(openBaseline.primary);
 const shown=await chartBitmap(page);expect(shown.axis,"Show preserves dates at unchanged geometry").toBe(openBaseline.axis);expect(shown.width).toBe(openBaseline.width);expect(shown.height).toBe(openBaseline.height);
 await capture(page,"product-show-fixed-geometry",info.project.name,{openBaseline,shown});
 const removeBaseline=shown;
 await activate(page,pill,touch);await activate(page,settings.getByTitle("Remove indicator",{exact:true}),touch);await expect(settings).toBeHidden();
 await expect.poll(()=>chartBitmap(page).then(v=>v.primary),"Settled Remove restores earlier-study pixels").toBe(removeBaseline.primary);const removed=await chartBitmap(page);expect(removed.axis,"Remove preserves dates").toBe(removeBaseline.axis);expect(removed.primary).toBe(removeBaseline.primary);
 const first=page.locator('.chart-study-pill[data-indicator-id]').filter({hasText:"First body study"}).first();
 await activate(page,first,touch);await activate(page,settings.getByTitle("Hide indicator",{exact:true}),touch);const restored=await chartBitmap(page);
 expect(restored.red).toBe(0);expect(restored.blue).toBe(0);expect(restored.axis).toBe(removeBaseline.axis);expect(restored.primary).not.toBe(removed.primary);
 const saved=context.storage.get("custom-indicator-scripts.v1") as any[];
 expect(saved).toEqual(savedScripts);for(const source of sources)expect(saved.find(s=>s.source===source)).toMatchObject({source,pinePrepared:{source}});
 expect(JSON.stringify(productBars)).toBe(originalBars);expect(pageErrors).toEqual([]);
 const assets=path.resolve("frontend/dist/assets"),workerName=fs.readdirSync(assets).find(name=>/^pine-native-worker.*\.js$/.test(name))!;
 const productionHash=createHash("sha256").update(fs.readFileSync(path.join(assets,workerName))).digest("hex");
 await expect.poll(()=>context.workerReceipts.length).toBeGreaterThan(0);
 for(const receipt of context.workerReceipts){expect(new URL(receipt.url).pathname).toBe("/assets/"+workerName);expect(receipt.sha256).toBe(productionHash);}
 await capture(page,"product-restored",info.project.name,{reverse,panned,edited,hidden,openBaseline,shown,removed,restored,workerReceipts:context.workerReceipts,productionHash});
});
