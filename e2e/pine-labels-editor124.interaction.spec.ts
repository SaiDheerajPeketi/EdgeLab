import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { productSetup, editor, checkedRun } from "./pine-layering.product-support";

async function observed(page: Page, source: string, count: number) {
  await expect.poll(()=>page.evaluate(({source,count})=>(window as any).__layerResults.some((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source&&r.result.inputs.in_0===count),{source,count})).toBe(true);
  return page.evaluate(({source,count})=>[...(window as any).__layerResults].reverse().find((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source&&r.result.inputs.in_0===count).result,{source,count});
}
async function pixels(page: Page) {
  return page.locator(".chart-stage").first().evaluate(stage=>{
    let ink=0,textInk=0,layers=0;
    for(const canvas of stage.querySelectorAll("canvas")) {
      if(canvas.getBoundingClientRect().height<80)continue;
      layers++;const bytes=canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data;
      for(let i=0;i<bytes.length;i+=4){if(bytes[i]===255&&bytes[i+1]===0&&bytes[i+2]===255&&bytes[i+3]>0)ink++;if(bytes[i]===0&&bytes[i+1]===255&&bytes[i+2]===0&&bytes[i+3]>0)textInk++;}
    }
    return {ink,textInk,layers};
  });
}

test("actual editor adds saved Pine demand labels, reruns custom inputs, and cleans real chart ink on Hide Show Remove",async({page},info)=>{
  test.setTimeout(120_000);const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const state=await productSetup(page);
  const source='//@version=6\nindicator("Saved demand labels",overlay=true,behind_chart=false)\ncount=input.int(2,"Labels",minval=1,maxval=4)\nif barstate.islast\n    for i=0 to count-1\n        label.new(bar_index-15-i*6,close-70+i*25,"Demand "+str.tostring(i+1),color=#ff00ff,textcolor=#00ff00,size=18,style=label.style_label_center,tooltip="Demand label "+str.tostring(i+1))';
  let dialog=await editor(page);await dialog.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source",{exact:true}).fill(source);await checkedRun(dialog);
  const preview=await observed(page,source,2);expect(preview.labels).toHaveLength(2);expect(preview.labels.every(l=>l.overlay&&l.color.toLowerCase()==="#ff00ff")).toBe(true);expect(preview.labels.map(b=>b.text)).toEqual(["Demand 1","Demand 2"]);
  await dialog.getByRole("button",{name:"Save",exact:true}).click();
  await expect.poll(()=>state.storage.get("custom-indicator-scripts.v1")?.some((s:any)=>s.source===source)).toBe(true);
  const saved=structuredClone(state.storage.get("custom-indicator-scripts.v1").find((s:any)=>s.source===source));
  await page.reload();dialog=await editor(page);await dialog.getByLabel("Script library",{exact:true}).selectOption(saved.id);await expect(dialog.getByLabel("EdgeLab indicator source",{exact:true})).toHaveValue(source);await checkedRun(dialog);
  const before=await page.evaluate(source=>(window as any).__layerResults.filter((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source).length,source);
  await dialog.getByRole("button",{name:"Add to chart",exact:true}).click();
  await expect.poll(()=>page.evaluate(source=>(window as any).__layerResults.filter((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source).length,source)).toBeGreaterThan(before);
  await dialog.getByRole("button",{name:"Close indicator editor",exact:true}).click();
  const row=page.locator(".native-study-chip").filter({hasText:"Saved demand labels"}).first();await expect(row).toBeVisible();
  await expect.poll(async()=>(await pixels(page)).ink).toBeGreaterThan(0);const originalPixels=await pixels(page);expect(originalPixels.textInk).toBeGreaterThan(0);
  await row.getByRole("button",{name:"Inputs for Saved demand labels",exact:true}).click();
  await row.getByLabel("Labels",{exact:true}).fill("3");const rerun=await observed(page,source,3);expect(rerun.labels).toHaveLength(3);expect(rerun.labels.map(b=>b.text)).toEqual(["Demand 1","Demand 2","Demand 3"]);expect(rerun.plots).toEqual([]);
  await expect.poll(async()=>(await pixels(page)).ink).toBeGreaterThan(originalPixels.ink);const rerunPixels=await pixels(page);expect(rerunPixels.textInk).toBeGreaterThan(0);
  await row.getByRole("button",{name:"Close inputs for Saved demand labels",exact:true}).click();
  await page.getByRole("button",{name:"Objects",exact:true}).first().click();const object=page.locator(".indicator-object-row").filter({hasText:saved.name}).first();
  await object.getByRole("button",{name:/^On: Hide /}).click();await expect.poll(async()=>(await pixels(page)).ink).toBe(0);await expect.poll(async()=>(await pixels(page)).textInk).toBe(0);
  await object.getByRole("button",{name:/^Off: Show /}).click();await expect.poll(async()=>(await pixels(page)).ink).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Collapse chart objects",exact:true}).click();await row.getByRole("button",{name:"Remove Saved demand labels",exact:true}).click();await expect(row).toHaveCount(0);await expect.poll(async()=>(await pixels(page)).ink).toBe(0);await expect.poll(async()=>(await pixels(page)).textInk).toBe(0);
  expect(state.storage.get("custom-indicator-scripts.v1").find((s:any)=>s.id===saved.id)).toEqual(saved);
  const workerName=fs.readdirSync("frontend/dist/assets").find(n=>/^pine-native-worker.*\.js$/.test(n))!,worker=fs.readFileSync(path.join("frontend/dist/assets",workerName)),sha256=createHash("sha256").update(worker).digest("hex");
  expect(state.workerReceipts.length).toBeGreaterThan(0);expect(state.workerReceipts.every(r=>r.sha256===sha256&&r.bytes===worker.length)).toBe(true);expect(errors).toEqual([]);
  const output=path.resolve(".artifacts/pine-labels-editor124",info.project.name);fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,"receipt.json"),JSON.stringify({workerName,sha256,preview,rerun,originalPixels,rerunPixels,workerReceipts:state.workerReceipts,errors},null,2));
});
const liveSource='//@version=6\nindicator("Live demand labels",overlay=true,behind_chart=false)\ncount=input.int(2,"Labels",minval=1,maxval=4)\nvar array<label> tags=array.new_label()\nif barstate.isfirst\n    for i=0 to count-1\n        array.push(tags,label.new(na,na,"",color=#ff00ff,textcolor=#00ff00,size=18,style=label.style_label_center))\nif barstate.islast\n    for i=0 to count-1\n        a=array.get(tags,i)\n        a.set_xy(bar_index-15-i*6,close-10-i*4)\n        a.set_text("Live "+str.tostring(close)+" / "+str.tostring(i+1))';
async function liveResults(page:Page){return page.evaluate(source=>((window as any).__layerResults??[]).flatMap(payload=>{const response=payload.protocol==='pine-live-v1'?payload.response:payload;return response?.status==='completed'&&response.result.kind==='run'&&response.result.source===source?[{...response.result,sessionId:payload.sessionId,sequence:payload.sequence}]:[];}),liveSource);}
async function latestLive(page:Page,predicate:(result:any)=>boolean){await expect.poll(async()=>(await liveResults(page)).some(predicate)).toBe(true);return(await liveResults(page)).findLast(predicate);}

test('actual live app updates persistent labels on market ticks and restarts input owners without stale ink',async({page},info)=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const sockets:any[]=[],providerEvents:any[]=[];
 await page.routeWebSocket(/data-stream\.binance\.vision/,socket=>{sockets.push(socket);socket.onClose(()=>{const i=sockets.indexOf(socket);if(i>=0)sockets.splice(i,1);});});
 const start=Date.parse('2026-09-15T00:30:00Z')/1000,history=Array.from({length:600},(_,i)=>({time:start+i*60,open:67500+i/10-1,high:67500+i/10+2,low:67500+i/10-2,close:67500+i/10,volume:10}));
 const providerRoutes=async()=>{
  await page.route('**/api/live/binance/instruments?**',route=>route.fulfill({json:{provider:'binance',instruments:[{symbol:'BTCUSDT',name:'BTCUSDT',status:'TRADING',asset_class:'crypto',base_asset:'BTC',quote_asset:'USDT',tick_size:.01,min_quantity:.00001,quantity_step:.00001}],total:1}}));
  await page.route('https://data-api.binance.vision/**',route=>{const url=new URL(route.request().url());if(url.pathname.endsWith('/klines'))return route.fulfill({json:url.searchParams.has('endTime')?[]:history.map(b=>[b.time*1000,String(b.open),String(b.high),String(b.low),String(b.close),String(b.volume),b.time*1000+59999])});if(url.pathname.endsWith('/ticker/24hr'))return route.fulfill({json:[{symbol:'BTCUSDT',lastPrice:'67559.9',priceChange:'1',priceChangePercent:'.1',highPrice:'67600',lowPrice:'67400',volume:'1000',quoteVolume:'67500000',openPrice:'67500',closeTime:Date.parse('2026-09-15T10:30:00Z')}]});return route.fulfill({json:{symbols:[{symbol:'BTCUSDT',status:'TRADING',baseAsset:'BTC',quoteAsset:'USDT'}]}});});
 };
 const state=await productSetup(page,{target:'/app/live',keepBinanceWebSocket:true,beforeNavigate:providerRoutes});await expect.poll(()=>sockets.length).toBeGreaterThan(0);const minute=page.getByRole('button',{name:'1m',exact:true}).first();if(await minute.isVisible())await minute.click();
 const dialog=await editor(page);await dialog.getByLabel('New script template',{exact:true}).selectOption('pine-indicator');await dialog.getByLabel('EdgeLab indicator source',{exact:true}).fill(liveSource);await checkedRun(dialog);await dialog.getByRole('button',{name:'Add to chart',exact:true}).click();await dialog.getByRole('button',{name:'Close indicator editor',exact:true}).click();
 const tools=page.getByRole('button',{name:'Tools',exact:true}).first();if(await tools.isVisible())await tools.click();const row=page.locator('.native-study-chip').filter({hasText:'Live demand labels'}).first();await expect(row).toBeVisible();let eventTime=Date.parse('2026-09-15T10:30:00Z');
 const emit=(index,close,confirmed)=>{const payload={stream:'btcusdt@kline_1m',data:{e:'kline',E:++eventTime,s:'BTCUSDT',k:{t:(start+index*60)*1000,T:(start+index*60)*1000+59999,i:'1m',s:'BTCUSDT',o:'67560',h:String(Math.max(67562,close+1)),l:String(Math.min(67558,close-1)),c:String(close),v:'15',x:confirmed}}};providerEvents.push(payload);for(const socket of sockets)if(socket.url().includes('btcusdt@kline_1m'))socket.send(JSON.stringify(payload));};
 emit(600,67561,false);const first=await latestLive(page,r=>r.audit.mode==='live'&&r.sequence===1),sessionId=first.sessionId;expect(first.labels).toHaveLength(2);expect(first.labels.map(l=>l.y)).toEqual([67551,67547]);expect(first.labels.every(l=>l.text.includes('67561'))).toBe(true);await expect.poll(async()=>(await pixels(page)).ink).toBeGreaterThan(0);
 emit(600,67570,false);const tick=await latestLive(page,r=>r.sessionId===sessionId&&r.sequence===2);expect(tick.labels.map(l=>l.id)).toEqual(first.labels.map(l=>l.id));expect(tick.labels.map(l=>l.y)).toEqual([67560,67556]);expect(tick.labels.every(l=>l.text.includes('67570'))).toBe(true);await expect.poll(async()=>(await pixels(page)).textInk).toBeGreaterThan(0);
 emit(600,67570,true);const closed=await latestLive(page,r=>r.sessionId===sessionId&&r.sequence===3);expect(closed.labels).toEqual(tick.labels);emit(601,67565,false);const next=await latestLive(page,r=>r.sessionId===sessionId&&r.sequence===4);expect(next.labels.map(l=>l.id)).toEqual(first.labels.map(l=>l.id));expect(next.labels.map(l=>l.y)).toEqual([67555,67551]);expect(next.labels.every(l=>l.text.includes('67565'))).toBe(true);
 await row.getByRole('button',{name:'Inputs for Live demand labels',exact:true}).click();await row.getByLabel('Labels',{exact:true}).fill('3');const changed=await latestLive(page,r=>r.sessionId!==sessionId&&r.inputs.in_0===3&&r.sequence===1);expect(changed.labels).toHaveLength(3);expect(changed.labels.every(l=>l.text.includes('67565'))).toBe(true);await row.getByRole('button',{name:'Close inputs for Live demand labels',exact:true}).click();
 await page.getByRole('button',{name:'Layers',exact:true}).first().click();const object=page.locator('.indicator-object-row').filter({hasText:'Live demand labels'}).first();await object.getByRole('button',{name:/^On: Hide /}).click();await expect.poll(async()=>(await pixels(page)).ink).toBe(0);await expect.poll(async()=>(await pixels(page)).textInk).toBe(0);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);await object.getByRole('button',{name:/^Off: Show /}).click();await latestLive(page,r=>r.sessionId!==changed.sessionId&&r.sequence===0&&r.inputs.in_0===3);await expect.poll(async()=>(await pixels(page)).ink).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Collapse chart objects',exact:true}).click();await row.getByRole('button',{name:'Remove Live demand labels',exact:true}).click();await expect(row).toHaveCount(0);await expect.poll(async()=>(await pixels(page)).ink).toBe(0);await expect.poll(async()=>(await pixels(page)).textInk).toBe(0);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);expect(errors).toEqual([]);
 const name=fs.readdirSync('frontend/dist/assets').find(n=>/^pine-native-worker.*\.js$/.test(n))!,worker=fs.readFileSync(path.join('frontend/dist/assets',name)),sha256=createHash('sha256').update(worker).digest('hex');expect(state.workerReceipts.every(r=>r.sha256===sha256&&r.bytes===worker.length)).toBe(true);const folder=path.resolve('.artifacts/pine-labels-editor124',info.project.name);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'live-receipt.json'),JSON.stringify({first,tick,closed,next,changed,providerEvents,workerName:name,sha256,workerReceipts:state.workerReceipts,errors},null,2));
});
