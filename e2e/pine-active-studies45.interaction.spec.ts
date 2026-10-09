import {pineChoose,pineLabel,pineOptions} from "./support/pine-select130";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {test,expect,type Page,type Locator} from "@playwright/test";
import {betaSessionResponse,FROZEN_TIME,gotoStable} from "./support/app";
import {fulfillReplayContext,prepare,bars as productBars} from "./support/replay-context";
import type {PineExecutionResult} from "../frontend/src/lib/pineProtocol";

const artifacts=path.resolve(".artifacts/pine-active-studies45/browser");
type Receipt={operation_id:string;method:string;path:string;status:"reserved"|"completed";http_status:number|null;result:null;created_at:string;completed_at:string|null};
async function fixture(page: Page) {
  const workerReceipts:Array<{url:string;sha256:string;bytes:number}>=[];
  // Read authentic HTTP bytes before opaque-frame teardown can invalidate CDP response-body lookup.
  await page.route("**/assets/pine-native-worker*.js",async route=>{const response=await route.fetch();const body=await response.body();workerReceipts.push({url:route.request().url(),sha256:createHash("sha256").update(body).digest("hex"),bytes:body.length});await route.fulfill({response,body});});
  await prepare(page);
  await fulfillReplayContext(page);
  const storage = new Map<string, unknown>();
  const receipts = new Map<string, Receipt>();
  const writes: Array<{ key: string; value: unknown }> = [];
  const storageReads: Array<{ key:string;value:unknown }>=[];
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
      if(request.method()==="GET")storageReads.push({key:decoded,value:structuredClone(storage.get(decoded)??null)});
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
      }
    }, true);
  });
  await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  // Establish readback on the existing canvas before genuine Add repaints it.
  await settled(page);
  return { storage, writes, storageReads, identity,workerReceipts };
}

async function openStudies(page:Page){const dialog=page.getByRole("dialog",{name:"Studies controls",exact:true});if(!await dialog.isVisible())await page.locator(".chart-studio-toolbar").getByRole("button",{name:"Studies",exact:true}).click();await expect(dialog).toBeVisible();return dialog;}
async function closeStudies(page:Page){const dialog=page.getByRole("dialog",{name:"Studies controls",exact:true});if(await dialog.isVisible())await dialog.getByRole("button",{name:"Close studies controls",exact:true}).click();}
async function openEditor(page: Page) {
  await closeStudies(page);
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



async function chartBitmap(page:Page){
 // Hash only the base canvases; observing them must not mutate genuine touch/hover state.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 return page.locator(".chart-stage").first().evaluate(async (stage,times)=>{
  const price=stage.querySelector(".chart-container-surface");if(!price)throw new Error("Owned primary price chart host unavailable");const nodes=[...price.querySelectorAll<HTMLCanvasElement>("canvas")],main=nodes.filter(c=>c.getBoundingClientRect().height>80).sort((a,b)=>b.width-a.width)[0];
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
  const chartAudit=api?{visible:api.timeScale().getVisibleLogicalRange(),pane:api.paneSize(),timeOptions:api.timeScale().options(),scrollPosition:api.timeScale().scrollPosition(),anchors:times.map((time:number)=>({time,x:api.timeScale().timeToCoordinate(time)}))}:null;
  return{chartAudit,scroll:{x:scrollX,y:scrollY},primary:await hash(main),axis:await hash(axis),width:main.width,height:main.height,red,blue,canvases:nodes.map(c=>{const r=c.getBoundingClientRect();return{width:c.width,height:c.height,x:r.x,y:r.y,cssWidth:r.width,cssHeight:r.height};})};
 },[productBars[0].time,productBars[24].time,productBars[48].time,productBars[72].time,productBars[96].time]);
}

async function action(control:Locator,touch:boolean){if(touch)await control.tap();else await control.click();}
async function settled(page:Page){
 const history:any[]=[];let last="",same=0;
 await expect.poll(async()=>{await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);const value=await chartBitmap(page);history.push(value);const identity=JSON.stringify([value.width,value.height,value.primary,value.axis,value.chartAudit]);same=identity===last?same+1:0;last=identity;return same;},{intervals:[100],message:"Genuine jobs, chart geometry and public time scale settle"}).toBeGreaterThanOrEqual(3);
 expect(history.at(-1).chartAudit,"Actual public IChartApi observation").not.toBeNull();
 return{value:history.at(-1),history};
}
async function record(page:Page,stem:string,project:string,value:unknown){
 fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,stem+"-"+project+".png")});
 fs.writeFileSync(path.join(artifacts,stem+"-"+project+".json"),JSON.stringify(value,null,2));
}

async function addNative(page:Page,context:any,source:string){
 const editor=await openEditor(page);await editor.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");await fillSource(editor,source);await check(editor);await run(editor);
 const result=await nativeRun(page,source);expect(result.source).toBe(source);expect(result.audit.engineVersion).toBe("0.11.0");
 await editor.getByRole("button",{name:"Save",exact:true}).click();await expect.poll(()=>((context.storage.get("custom-indicator-scripts.v1") as any[])??[]).some(s=>s.source===source)).toBe(true);
 const before=await page.evaluate(source=>(window as any).__nativeEditorResults.filter((p:any)=>p.status==="completed"&&p.result.kind==="run"&&p.result.source===source).length,source);await editor.getByRole("button",{name:"Add to chart",exact:true}).click();await expect.poll(()=>page.evaluate(source=>(window as any).__nativeEditorResults.filter((p:any)=>p.status==="completed"&&p.result.kind==="run"&&p.result.source===source).length,source)).toBeGreaterThan(before);await editor.getByRole("button",{name:"Close indicator editor",exact:true}).click();await settled(page);await openStudies(page);return result;
}
async function clickOwned(page:Page,control:Locator,touch:boolean){
 await control.evaluate(e=>e.scrollIntoView({block:"center",inline:"nearest"}));const proof=await control.evaluate(b=>{const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{width:r.width,height:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,owns:!!hit&&b.contains(hit)};});
 expect(proof.width).toBeGreaterThanOrEqual(44);expect(proof.height).toBeGreaterThanOrEqual(44);expect(proof.inside).toBe(true);expect(proof.owns,"Ordinary native control owns actual hit").toBe(true);await action(control,touch);
}
async function matching(page:Page,source:string,inputs:Record<string,unknown>){
 await expect.poll(()=>page.evaluate(({source,inputs})=>(window as any).__nativeEditorResults.some((p:any)=>p.status==="completed"&&p.result.kind==="run"&&p.result.source===source&&Object.entries(inputs).every(([key,value])=>p.result.inputs[key]===value)),{source,inputs})).toBe(true);
 await settled(page);return page.evaluate(({source,inputs})=>[...(window as any).__nativeEditorResults].reverse().find((p:any)=>p.status==="completed"&&p.result.kind==="run"&&p.result.source===source&&Object.entries(inputs).every(([key,value])=>p.result.inputs[key]===value)).result,{source,inputs});
}
async function identity(row:Locator,name:string,version:number){
 await row.scrollIntoViewIfNeeded();const metrics=await row.evaluate(r=>[...r.querySelectorAll<HTMLElement>(".native-study-name,.native-study-caption")].map(e=>{const b=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);return{text:e.textContent,width:e.clientWidth,scroll:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight,ellipsis:getComputedStyle(e).textOverflow,rects:[...range.getClientRects()].map(t=>({inside:t.left>=b.left-1&&t.right<=b.right+1&&t.top>=b.top-1&&t.bottom<=b.bottom+1,owns:e.contains(document.elementFromPoint((t.left+t.right)/2,(t.top+t.bottom)/2))}))};}));
 expect(metrics.map(m=>m.text)).toEqual([name,expect.stringMatching(new RegExp("^Native Pine v"+version+" · revision [0-9]+$"))]);for(const m of metrics){expect(m.scroll).toBeLessThanOrEqual(m.width);expect(m.scrollHeight).toBeLessThanOrEqual(m.height);expect(m.ellipsis).not.toBe("ellipsis");for(const r of m.rects){expect(r.inside).toBe(true);expect(r.owns,"Full source identity is not obscured").toBe(true);}}return metrics;
}
function noGeneric(row:Locator){return Promise.all([expect(row.getByRole("spinbutton",{name:"Len",exact:true})).toHaveCount(0),expect(row.getByRole("button",{name:"Study color palette",exact:true})).toHaveCount(0),expect(row.getByRole("textbox",{name:"Study color hex code",exact:true})).toHaveCount(0)]);}
async function receipts(context:any){
 const worker=fs.readdirSync("frontend/dist/assets").find(n=>/^pine-native-worker.*\.js$/.test(n))!,body=fs.readFileSync(path.join("frontend/dist/assets",worker)),sha=createHash("sha256").update(body).digest("hex");expect(context.workerReceipts.length).toBeGreaterThan(0);for(const r of context.workerReceipts){expect(r.sha256).toBe(sha);expect(r.bytes).toBe(body.length);}return{sha,bytes:body.length,receipts:context.workerReceipts};
}
test("native v5 and v6 Active Studies inputs drive genuine results and match Objects without generic controls",async({page},info)=>{
 test.setTimeout(180000);const touch=!!(info.project.use.hasTouch||info.project.use.isMobile),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));const context=await fixture(page);
 for(const version of [5,6]){
  const name="Native v"+version+" inputs",source='//@version='+version+'\nindicator("'+name+'",overlay=false)\nlength=input.int(5,"Length",minval=1,maxval=100)\nshade=input.color(#ff0000,"Shade")\nenabled=input.bool(true,"Enabled")\nmode=input.string("Fast","Mode",options=["Fast","Slow"])\nplot(ta.sma(close,mode=="Fast"?length:length*2),title="Mean",color=shade)\nbarcolor(enabled?shade:na,title="Body")';
  const defaults=await addNative(page,context,source),saved=structuredClone(context.storage.get("custom-indicator-scripts.v1"));
  const strip=page.getByRole("dialog",{name:"Studies controls",exact:true}),row=strip.locator(".native-study-chip").filter({hasText:name}).first();await expect(row).toBeVisible();await noGeneric(row);
  const builtin=strip.locator(".study-chip").filter({hasText:"EMA 20"}).first();await expect(builtin.getByRole("spinbutton",{name:"Len",exact:true})).toHaveValue("20");await expect(builtin.getByRole("button",{name:"Study color palette",exact:true})).toBeVisible();
  const visibleIdentity=await identity(row,name,version);await record(page,"native-identity-v"+version,info.project.name,{visibleIdentity,defaults});
  const trigger=row.getByRole("button",{name:"Inputs for "+name,exact:true}),group=row.getByRole("group",{name:"Pine inputs for "+name,exact:true});
  await clickOwned(page,trigger,touch);await expect(trigger).toHaveAttribute("aria-expanded","true");await expect(group.getByRole("spinbutton",{name:"Length",exact:true})).toHaveValue("5");await expect(group.getByRole("textbox",{name:"Shade",exact:true})).toHaveValue(String(defaults.inputDefinitions.find(d=>d.title==="Shade")!.defval));await expect(group.getByRole("checkbox",{name:"Enabled",exact:true})).toBeChecked();await pineLabel(group.getByRole("combobox",{name:"Mode",exact:true}),"Fast");
  const baseline=await settled(page);expect(baseline.value.red).toBeGreaterThan(0);
  await group.getByRole("spinbutton",{name:"Length",exact:true}).fill("8");await matching(page,source,{in_0:8});
  await group.getByRole("textbox",{name:"Shade",exact:true}).fill("#0000ff");await matching(page,source,{in_0:8,in_1:"#0000ff"});
  await group.getByRole("checkbox",{name:"Enabled",exact:true}).uncheck();await matching(page,source,{in_2:false});const disabled=await settled(page);await record(page,"native-disabled-v"+version,info.project.name,{disabled,result:await nativeRun(page,source)});expect(disabled.value.blue).toBe(0);expect(disabled.value.red).toBe(0);
  await group.getByRole("checkbox",{name:"Enabled",exact:true}).check();await matching(page,source,{in_2:true});
  await pineChoose(group.getByRole("combobox",{name:"Mode",exact:true}),"Slow");const result=await matching(page,source,{in_0:8,in_1:"#0000ff",in_2:true,in_3:"Slow"}),edited=await settled(page);expect(edited.value.blue).toBeGreaterThan(0);expect(edited.value.red).toBe(0);await record(page,"native-input-diagnostic-v"+version,info.project.name,{baseline,edited,source,result});expect(edited.value.axis).toBe(baseline.value.axis);
  const mean=result.plots.find((p:any)=>p.name==="Mean").points.at(-1);const expected=productBars.slice(81,97).reduce((sum,b)=>sum+b.close,0)/16;expect(mean.time).toBe(productBars[96].time);expect(Math.abs(mean.value-expected),"Independent16-bar SMA after Length+Mode inputs").toBeLessThan(1e-8);
  await record(page,"native-edited-v"+version,info.project.name,{result,baseline,edited,visibleIdentity,source});
  const close=row.getByRole("button",{name:"Close inputs for "+name,exact:true});await clickOwned(page,close,touch);await expect(group).toBeHidden();await expect(trigger).toBeFocused();
  await trigger.press("Enter");await expect(group).toBeVisible();await close.focus();await page.keyboard.press("Escape");await expect(group).toBeHidden();await expect(trigger).toBeFocused();
  const playback=page.locator('[data-ui-panel="replay-transport"]').getByRole("button",{name:/^(Play|Pause)$/,includeHidden:true}),state=(await playback.textContent())!.trim();await trigger.press("Space");await expect(group).toBeVisible();await expect(playback).toHaveText(state);await clickOwned(page,close,touch);
  await closeStudies(page);await action(page.getByRole("button",{name:"Objects",exact:true}).first(),touch);const object=page.locator(".indicator-object-row").filter({hasText:name}).first();await action(object.getByRole("button",{name:"Settings for "+name,exact:true}),touch);
  const objectSettings=object.getByRole("group",{name:"Settings for "+name,exact:true});await expect(objectSettings.getByRole("spinbutton",{name:"Length",exact:true})).toHaveValue("8");await expect(objectSettings.getByRole("textbox",{name:"Shade",exact:true})).toHaveValue("#0000ff");await expect(objectSettings.getByRole("checkbox",{name:"Enabled",exact:true})).toBeChecked();await pineLabel(objectSettings.getByRole("combobox",{name:"Mode",exact:true}),"Slow");
  await objectSettings.getByRole("spinbutton",{name:"Length",exact:true}).fill("9");await matching(page,source,{in_0:9});await action(page.getByRole("button",{name:"Collapse chart objects",exact:true}),touch);await openStudies(page);
  await clickOwned(page,trigger,touch);await expect(group.getByRole("spinbutton",{name:"Length",exact:true})).toHaveValue("9");await clickOwned(page,close,touch);
  expect(context.storage.get("custom-indicator-scripts.v1")).toEqual(saved);await expect(builtin.getByRole("spinbutton",{name:"Len",exact:true})).toHaveValue("20");
  await clickOwned(page,row.getByRole("button",{name:"Remove "+name,exact:true}),touch);await expect(row).toHaveCount(0);await settled(page);await expect(strip.getByRole("button",{name:"Remove EMA 20",exact:true})).toBeFocused();
 }
 expect(errors).toEqual([]);await record(page,"native-complete",info.project.name,{errors,worker:await receipts(context)});
});
test("zero-input source is distinct from rejected prepared metadata and recovers through actual Check Save",async({page},info)=>{
 test.setTimeout(120000);const touch=!!(info.project.use.hasTouch||info.project.use.isMobile),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));const context=await fixture(page);
 const source='//@version=6\nindicator("Native no inputs",overlay=false)\nbarcolor(#ff0000,title="Body")';await addNative(page,context,source);
 const original=(context.storage.get("custom-indicator-scripts.v1") as any[]).find(s=>s.source===source),missing={...structuredClone(original),id:"rejected-missing",name:"Rejected missing prepare"},stale={...structuredClone(original),id:"rejected-stale",name:"Rejected stale prepare",source:source.replace("Native no inputs","Rejected stale prepare")};delete missing.pinePrepared;
 context.storage.set("custom-indicator-scripts.v1",[original,missing,stale]);await page.reload();await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
 await expect.poll(()=>context.storageReads.some(r=>r.key==="custom-indicator-scripts.v1"&&Array.isArray(r.value)&&r.value.some(s=>s.id==="rejected-missing")&&r.value.some(s=>s.id==="rejected-stale"))).toBe(true);
 const editor=await openEditor(page),library=editor.getByLabel("Script library",{exact:true});await expect(library.getByRole("option",{name:/Rejected missing prepare|Rejected stale prepare/})).toHaveCount(0);
 await library.selectOption(original.id);await expect(editor.getByLabel("EdgeLab indicator source",{exact:true})).toHaveValue(source);await check(editor);await run(editor);const result=await nativeRun(page,source);expect(result.inputDefinitions).toEqual([]);
 await editor.getByRole("button",{name:"Add to chart",exact:true}).click();await editor.getByRole("button",{name:"Close indicator editor",exact:true}).click();await settled(page);await openStudies(page);
 const row=page.locator(".native-study-chip").filter({hasText:"Native no inputs"}).first();await noGeneric(row);const trigger=row.getByRole("button",{name:"Inputs for Native no inputs",exact:true});await clickOwned(page,trigger,touch);const group=row.getByRole("group",{name:"Pine inputs for Native no inputs",exact:true});await expect(group).toContainText("No configurable Pine inputs.");await expect(group).not.toContainText("Check and save");await expect(group.locator("input,select")).toHaveCount(0);await record(page,"native-no-inputs",info.project.name,{result,source,storageReads:context.storageReads});
 const recovered=["//@version=6","indicator(\"Recovered native\",overlay=false)","length=input.int(5,\"Length\")",...Array.from({length:7},(_,i)=>"span"+(i+1)+"=input.int(1,\"Span "+(i+1)+"\",minval=1,maxval=10)"),"plot(ta.sma(close,length+span1+span2+span3+span4+span5+span6+span7),title=\"Recovery mean\",color=color.blue)","barcolor(#0000ff,title=\"Body\")"].join("\n");const recovery=await addNative(page,context,recovered);expect(recovery.inputDefinitions.find(d=>d.title==="Length")!.defval).toBe(5);
 const recoveredRow=page.locator(".native-study-chip").filter({hasText:"Recovered native"}).first();await clickOwned(page,recoveredRow.getByRole("button",{name:"Inputs for Recovered native",exact:true}),touch);await expect(recoveredRow.getByRole("spinbutton",{name:"Length",exact:true})).toHaveValue("5");await noGeneric(recoveredRow);
 const inputList=recoveredRow.locator(".native-study-input-list"),bounds=await inputList.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,limit:Math.min(288,innerHeight*.45)}));expect(bounds.scroll).toBeGreaterThan(bounds.height);expect(bounds.height).toBeLessThanOrEqual(bounds.limit);
 const last=recoveredRow.getByRole("spinbutton",{name:"Span 7",exact:true});for(let i=0;i<12&&!await last.evaluate(e=>e===document.activeElement);i++)await page.keyboard.press("Tab");await expect(last).toBeFocused();const tabGeometry=await last.evaluate(e=>{const b=e.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return{x:b.x,y:b.y,width:b.width,height:b.height,viewport:innerHeight,hit:hit?.outerHTML.slice(0,400)};});await record(page,"native-last-tab-observation",info.project.name,{tabGeometry,bounds});const lastHit=await last.evaluate(e=>{const b=e.getBoundingClientRect();return{height:b.height,owns:e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};});expect(lastHit.height).toBeGreaterThanOrEqual(44);expect(lastHit.owns).toBe(true);await last.fill("3");const changed=await matching(page,recovered,{in_7:3});const tail=changed.plots.find((p:any)=>p.name==="Recovery mean").points.at(-1),expected=productBars.slice(83,97).reduce((sum,b)=>sum+b.close,0)/14;expect(tail.time).toBe(productBars[96].time);expect(Math.abs(tail.value-expected)).toBeLessThan(1e-8);
 const saved=context.storage.get("custom-indicator-scripts.v1") as any[];expect(saved.find(s=>s.source===source)).toEqual(original);expect(saved.find(s=>s.source===recovered)?.pinePrepared.source).toBe(recovered);expect(errors).toEqual([]);
 await record(page,"native-recovered",info.project.name,{source,recovered,result,recovery,changed,bounds,tabGeometry,lastHit,worker:await receipts(context),limitation:"Invalid native prepared metadata is rejected before active UI; no fabricated active-unprepared branch."});
});
