import {expect,test,type Page,type Locator} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {betaSessionResponse,FROZEN_TIME,gotoStable,installDeterminism,seedApprovedSession} from "./support/app";
import {bars,fulfillReplayContext} from "./support/replay-context";

type Mode="ok"|"503"|"null"|"wrongKey"|"wrongValue";
type Kind="Drawing"|"Fib";
const artifacts=path.resolve(".artifacts/preset-persistence100");
async function fixture(page:Page,holdLoad=false) {
 await installDeterminism(page);await seedApprovedSession(page);await fulfillReplayContext(page);
 const storage=new Map<string,any>(),receipts=new Map<string,any>();
 const writes:any[]=[],attempts:any[]=[],errors:string[]=[],reads:string[]=[];
 let mode:Mode="ok",target="",holdWrite=false,releaseWrite:(()=>void)|undefined,releaseLoad:(()=>void)|undefined;
 const loadGate=new Promise<void>(resolve=>{releaseLoad=resolve;});
 page.on("pageerror",e=>errors.push(e.message));
 storage.set("chart-layout.v1",{chartStyle:"candles",drawings:[
  {id:"audit-fib",tool:"fib",label:"Audit Fib",color:"#32d3ee",createdAt:"2026-09-15T08:00:00Z",points:[{time:bars[70].time,price:67900},{time:bars[80].time,price:68200}]},
  {id:"audit-line",tool:"horizontal",label:"Audit Line",color:"#ffbe55",createdAt:"2026-09-15T08:01:00Z",points:[{time:bars[70].time,price:68000}]}
 ],indicatorInstances:[],magnetMode:"off",paneLayout:"single",schemaVersion:2,settingsDefaultsVersion:2,showOrderOverlays:true,smoothCandles:false,timeframe:"5m"});
 await page.route("**/api/**",async route=>{
  const request=route.request(),endpoint=new URL(request.url()).pathname.replace(/^\/api/,"");
  if(endpoint==="/auth/session"){await route.fulfill({json:betaSessionResponse});return;}
  const metadata=endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
  if(metadata){const [,id,action]=metadata;if(action==="reserve")receipts.set(id,{operation_id:id,...request.postDataJSON(),status:"reserved",http_status:null,result:null,created_at:FROZEN_TIME,completed_at:null});await route.fulfill({json:receipts.get(id)});return;}
  const bound=request.headers()["x-edgelab-operation-id"];
  const complete=(status:number)=>{if(bound&&receipts.has(bound))Object.assign(receipts.get(bound),{status:"completed",http_status:status,completed_at:FROZEN_TIME});};
  if(endpoint==="/settings/chart/presets"&&request.method()==="POST"){
   const intent=request.postDataJSON(),decoded=intent.kind==="drawing"?"drawing-presets.v1":"fib-presets.v1";
   const active=decoded===target?mode:"ok";
   const before=structuredClone(storage.get(decoded)??[]);
   const value=intent.action==="delete"?before.filter((p:any)=>p.id!==intent.id):
    [intent.preset,...before.filter((p:any)=>p.id!==intent.preset.id&&!(p.name.trim().toLocaleLowerCase()===intent.preset.name.trim().toLocaleLowerCase()&&(intent.kind!=="drawing"||p.tool===intent.preset.tool)))];
   const attempt={key:decoded,intent:structuredClone(intent),value,mode:active,completed:false};attempts.push(attempt);
   if(decoded===target&&holdWrite){holdWrite=false;await new Promise<void>(resolve=>{releaseWrite=resolve;});}
   complete(active==="503"?503:200);attempt.completed=true;
   if(active==="503"){await route.fulfill({status:503,json:{detail:"Preset service unavailable"}});return;}
   if(active==="ok"){storage.set(decoded,value);writes.push({key:decoded,value});}
   const body=active==="null"?null:{namespace:"edgelab",key:active==="wrongKey"?"unrelated.v1":decoded,value:active==="wrongValue"?before:value,updated_at:FROZEN_TIME};
   await route.fulfill({body:JSON.stringify(body),contentType:"application/json"});return;
  }
  const key=endpoint.match(/^\/app-storage\/edgelab\/(.+)$/)?.[1];
  if(key){
   const decoded=decodeURIComponent(key);
   if(request.method()==="GET"){
    const snapshot=structuredClone(storage.get(decoded)??null);
    reads.push(decoded);
    if(holdLoad&&/^(drawing|fib)-presets\.v1$/.test(decoded))await loadGate;
    complete(200);await route.fulfill({json:{namespace:"edgelab",key:decoded,value:snapshot,updated_at:FROZEN_TIME}});return;
   }
   if(request.method()==="PUT"){
    const value=structuredClone(request.postDataJSON().value),active=decoded===target?mode:"ok";
    const attempt={key:decoded,value,mode:active,completed:false};attempts.push(attempt);
    if(decoded===target&&holdWrite){holdWrite=false;await new Promise<void>(resolve=>{releaseWrite=resolve;});}
    complete(active==="503"?503:200);attempt.completed=true;
    if(active==="503"){await route.fulfill({status:503,json:{detail:"Preset service unavailable"}});return;}
    if(active==="ok"){storage.set(decoded,value);writes.push({key:decoded,value});}
    const body=active==="null"?null:{namespace:"edgelab",key:active==="wrongKey"?"unrelated.v1":decoded,value:active==="wrongValue"?[]:value,updated_at:FROZEN_TIME};
    await route.fulfill({body:JSON.stringify(body),contentType:"application/json"});return;
   }
  }
  complete(200);await route.fallback();
 });
 await gotoStable(page,"/app/replay",{waitForNetworkIdle:false});
 await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
 await page.getByRole("button",{name:"Objects",exact:true}).first().click();
 await expect(page.locator(".drawing-object-row").filter({hasText:"Audit Fib"})).toBeVisible();
 return {storage,writes,attempts,errors,reads,mode:(key:string,next:Mode)=>{target=key;mode=next;},hold:(key:string)=>{target=key;mode="ok";holdWrite=true;},release:()=>releaseWrite?.(),releaseLoad:()=>releaseLoad?.()};
}
async function controls(page:Page,kind:Kind){
 const row=page.locator(".drawing-object-row").nth(kind==="Drawing"?1:0);
 await row.focus();await row.press("Enter");await expect(row).toHaveClass(/chart-object-row-selected/);
 await page.locator('.chart-stage .drawing-anchor-group circle[fill="transparent"]').first().click();
 const toolbar=page.getByRole("group",{name:"Drawing settings",exact:true});await expect(toolbar).toBeVisible();
 return {toolbar,input:toolbar.getByRole("textbox",{name:kind==="Drawing"?"Drawing label":"Fib preset name",exact:true}),
  save:toolbar.getByTitle(kind==="Drawing"?"Save label/style preset":"Save fib preset",{exact:true}),
  trigger:toolbar.getByRole("button",{name:kind+" presets",exact:true}),
  menu:page.getByRole("menu",{name:kind+" presets",exact:true}),
  key:kind==="Drawing"?"drawing-presets.v1":"fib-presets.v1"};
}
async function closeMenu(c:Awaited<ReturnType<typeof controls>>){if(await c.menu.isVisible()){await c.menu.press("Escape");await expect(c.menu).toBeHidden();}}
async function names(state:Awaited<ReturnType<typeof fixture>>,key:string){return state.storage.get(key)?.map((p:any)=>p.name);}
async function capture(page:Page,name:string,receipt:any){
 fs.mkdirSync(artifacts,{recursive:true});fs.writeFileSync(path.join(artifacts,name+".json"),JSON.stringify(receipt,null,2));
 const file=path.join(artifacts,name+".png");if(process.env.EDGELAB_PRESETS100_CAPTURE!=="0"&&!fs.existsSync(file))await page.screenshot({path:file,animations:"disabled"});
}

for(const kind of ["Drawing","Fib"] as const){
 test(kind+" rejected and malformed preset acknowledgements retain originals and retry captured intent",async({page},info)=>{
  const state=await fixture(page),c=await controls(page,kind);
  const feedback=page.getByRole("group",{name:kind+" preset status",exact:true});
  const good=kind+" confirmed",failed=kind+" unsaved",later=kind+" later draft";
  await c.input.fill(good);await c.save.click();await expect.poll(()=>names(state,c.key)).toEqual([good]);await expect(c.save).toBeEnabled();
  state.mode(c.key,"503");await c.input.fill(failed);await c.save.click();
  await expect(feedback.getByRole("alert")).toContainText("Couldn't confirm");await expect(c.input).toHaveValue(failed);await expect(c.save).toBeEnabled();
  await c.trigger.click();await expect(c.menu.getByRole("menuitemradio",{name:"Apply "+good,exact:true})).toBeVisible();await expect(c.menu.getByRole("menuitemradio",{name:"Apply "+failed,exact:true})).toHaveCount(0);
  expect(await names(state,c.key)).toEqual([good]);await closeMenu(c);
  const geometry=await Promise.all([c.trigger,c.save,feedback.getByRole("alert")].map(l=>l.evaluate((el:HTMLElement)=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};})));
  fs.mkdirSync(artifacts,{recursive:true});fs.writeFileSync(path.join(artifacts,"geometry-"+info.project.name+"-"+kind.toLowerCase()+".json"),JSON.stringify(geometry,null,2));
  if(kind==="Drawing")expect(geometry[2].top).toBeGreaterThanOrEqual(Math.max(geometry[0].bottom,geometry[1].bottom)+2);
  else expect(geometry[2].bottom+2).toBeLessThanOrEqual(Math.min(geometry[0].top,geometry[1].top));
  await capture(page,"final-"+info.project.name+"-"+kind.toLowerCase(),{kind,geometry,failedSave:state.attempts.filter(a=>a.key===c.key),alerts:await feedback.getByRole("alert").allTextContents(),draft:await c.input.inputValue()});
  await c.input.fill(later);state.mode(c.key,"ok");await feedback.getByRole("button",{name:"Retry save",exact:true}).click();
  await expect.poll(()=>names(state,c.key)).toEqual([failed,good]);await expect(feedback.getByRole("alert")).toHaveCount(0);await expect(c.input).toHaveValue(later);
  expect(state.attempts.filter(a=>a.key===c.key).at(-1).intent.preset.name).toBe(failed);
  for(const mode of ["null","wrongKey","wrongValue"] as const){
   const draft=kind+" "+mode;state.mode(c.key,mode);await c.input.fill(draft);await c.save.click();
   await expect(feedback.getByRole("alert")).toContainText("Couldn't confirm");await expect(c.save).toBeEnabled();await expect(c.input).toHaveValue(draft);
   await c.trigger.click();await expect(c.menu.getByRole("menuitemradio")).toHaveCount(2);await expect(c.menu.getByRole("menuitemradio",{name:"Apply "+draft,exact:true})).toHaveCount(0);await closeMenu(c);
   expect(await names(state,c.key)).toEqual([failed,good]);
  }
  state.mode(c.key,"ok");await feedback.getByRole("button",{name:"Retry save",exact:true}).click();
  await expect.poll(()=>names(state,c.key)).toEqual([kind+" wrongValue",failed,good]);await expect(feedback.getByRole("alert")).toHaveCount(0);
  state.mode(c.key,"503");await c.trigger.click();await c.menu.getByRole("menuitem",{name:"Delete "+good,exact:true}).click();
  await expect(feedback.getByRole("alert")).toContainText("Couldn't confirm");expect(await names(state,c.key)).toEqual([kind+" wrongValue",failed,good]);
  if(!await c.menu.isVisible())await c.trigger.click();
  await expect(c.menu.getByRole("menuitemradio",{name:"Apply "+good,exact:true})).toBeVisible();await closeMenu(c);
  const id=state.storage.get(c.key).find((p:any)=>p.name===good).id;
  state.mode(c.key,"ok");await feedback.getByRole("button",{name:"Retry delete",exact:true}).click();
  await expect.poll(()=>names(state,c.key)).toEqual([kind+" wrongValue",failed]);await expect(feedback.getByRole("alert")).toHaveCount(0);
  expect(state.attempts.filter(a=>a.key===c.key).at(-1).intent).toEqual({kind:kind.toLowerCase(),action:"delete",id});
  expect(state.errors).toEqual([]);
 });
 test(kind+" delayed load and held save protect drafts, block duplicates and isolate drawing scope",async({page})=>{
  const state=await fixture(page,true),c=await controls(page,kind);
  await expect.poll(()=>state.reads.filter(k=>k===c.key).length).toBeGreaterThan(0);await expect(c.save).toBeDisabled();await expect(c.trigger).toBeDisabled();
  await c.input.fill(kind+" while loading");await c.save.evaluate((el:HTMLButtonElement)=>el.click());expect(state.attempts.filter(a=>a.key===c.key)).toHaveLength(0);
  state.releaseLoad();await expect(c.save).toBeEnabled();await c.save.click();await expect.poll(()=>names(state,c.key)).toEqual([kind+" while loading"]);await expect(c.save).toBeEnabled();
  await c.input.fill(kind+" snapshot");state.hold(c.key);await c.save.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});
  await expect.poll(()=>state.attempts.filter(a=>a.key===c.key).length).toBe(2);await expect(c.save).toBeDisabled();
  await c.input.fill(kind+" later draft");
  if(kind==="Fib")await c.toolbar.getByRole("spinbutton",{name:"Fib ratio",exact:true}).first().fill("0.17");
  await c.trigger.click();await expect(c.menu.getByRole("menuitem",{name:"Delete "+kind+" while loading",exact:true})).toBeDisabled();await closeMenu(c);
  state.release();await expect.poll(()=>names(state,c.key)).toEqual([kind+" snapshot",kind+" while loading"]);await expect(c.save).toBeEnabled();await expect(c.input).toHaveValue(kind+" later draft");
  if(kind==="Fib")await expect(c.toolbar.getByRole("spinbutton",{name:"Fib ratio",exact:true}).first()).toHaveValue("0.17");
  expect(state.attempts.filter(a=>a.key===c.key)).toHaveLength(2);
  await c.save.click();await expect.poll(()=>names(state,c.key)).toEqual([kind+" later draft",kind+" snapshot",kind+" while loading"]);
  if(kind==="Fib"){expect(state.storage.get(c.key)[0].levels[0].value).toBe(.17);expect(state.storage.get(c.key)[1].levels[0].value).not.toBe(.17);}
  await expect(c.save).toBeEnabled();await c.input.fill(kind+" departing");state.hold(c.key);await c.save.click();await expect.poll(()=>state.attempts.filter(a=>a.key===c.key).length).toBe(4);
  await page.locator(".drawing-object-row").nth(kind==="Drawing"?0:1).focus();await page.locator(".drawing-object-row").nth(kind==="Drawing"?0:1).press("Enter");
  const next=page.getByRole("group",{name:"Drawing settings",exact:true}),nextInput=next.getByRole("textbox",{name:kind==="Drawing"?"Fib preset name":"Drawing label",exact:true});
  await expect(nextInput).toBeVisible();await nextInput.fill("Next drawing draft");state.release();
  await expect.poll(()=>names(state,c.key)).toEqual([kind+" departing",kind+" later draft",kind+" snapshot",kind+" while loading"]);
  await expect(nextInput).toHaveValue("Next drawing draft");await expect(next.getByRole("status").filter({hasText:kind+" departing"})).toHaveCount(0);
  expect(state.errors).toEqual([]);
 });
}
