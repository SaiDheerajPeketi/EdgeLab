import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {test,expect,type Page,type Locator} from "@playwright/test";
import {betaSessionResponse,FROZEN_TIME,gotoStable} from "./support/app";
import {fulfillReplayContext,prepare,bars as productBars} from "./support/replay-context";
import type {PineExecutionResult} from "../frontend/src/lib/pineProtocol";

const artifacts=path.resolve(".artifacts/pine-objects44/browser");
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
  const chartAudit=api?{visible:api.timeScale().getVisibleLogicalRange(),pane:api.paneSize(),timeOptions:api.timeScale().options(),scrollPosition:api.timeScale().scrollPosition(),anchors:times.map((time:number)=>({time,x:api.timeScale().timeToCoordinate(time)}))}:null;
  return{chartAudit,scroll:{x:scrollX,y:scrollY},primary:await hash(main),axis:await hash(axis),width:main.width,height:main.height,red,blue,canvases:nodes.map(c=>{const r=c.getBoundingClientRect();return{width:c.width,height:c.height,x:r.x,y:r.y,cssWidth:r.width,cssHeight:r.height};})};
 },[productBars[0].time,productBars[24].time,productBars[48].time,productBars[72].time,productBars[96].time]);
}

async function action(control:Locator,touch:boolean){if(touch)await control.tap();else await control.click();}
async function settled(page:Page){
 const history:any[]=[];let last="",same=0;
 await expect.poll(async()=>{await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);const value=await chartBitmap(page);history.push(value);const identity=JSON.stringify([value.width,value.height,value.axis,value.chartAudit]);same=identity===last?same+1:0;last=identity;return same;},{intervals:[100],message:"Genuine jobs, chart geometry and public time scale settle"}).toBeGreaterThanOrEqual(3);
 expect(history.at(-1).chartAudit,"Actual public IChartApi observation").not.toBeNull();
 return{value:history.at(-1),history};
}
async function record(page:Page,stem:string,project:string,value:unknown){
 fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,stem+"-"+project+".png")});
 fs.writeFileSync(path.join(artifacts,stem+"-"+project+".json"),JSON.stringify(value,null,2));
}
test("baseline genuine native Objects drawer roundtrip and visibility obstruction",async({page},info)=>{
 test.skip(!process.env.EDGELAB_OBJECTS_BASELINE,"Frozen43 diagnosis is retained separately from final44 gates");test.setTimeout(90000);const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 const touch=!!(info.project.use.hasTouch||info.project.use.isMobile),context=await fixture(page);
 const source='//@version=6\nindicator("Native Objects proof",overlay=false)\nshade=input.color(#ff0000,"Shade")\nbarcolor(shade,title="Body")';
 const editor=await openEditor(page);await editor.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");
 await fillSource(editor,source);await check(editor);await run(editor);const native=await nativeRun(page,source);
 expect(native.audit.engineVersion).toBe("0.11.0");expect(native.source).toBe(source);
 await editor.getByRole("button",{name:"Save",exact:true}).click();
 await expect.poll(()=>((context.storage.get("custom-indicator-scripts.v1") as any[])??[]).some(s=>s.source===source)).toBe(true);
 await editor.getByRole("button",{name:"Add to chart",exact:true}).click();
 await editor.getByRole("button",{name:"Close indicator editor",exact:true}).click();
 const pill=page.locator('.chart-study-pill[data-indicator-id]').filter({hasText:"Native Objects proof"}).first();await expect(pill).toBeVisible();
 await settled(page);const canvas=page.locator(".chart-stage canvas").first();await canvas.scrollIntoViewIfNeeded();
 const beforePan=await settled(page),box=(await canvas.boundingBox())!;
 await page.mouse.move(box.x+box.width*.55,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.55+80,box.y+box.height*.5,{steps:8});await page.mouse.up();
 const closed=await settled(page);expect(closed.value.axis,"Actual pointer drag changes dates").not.toBe(beforePan.value.axis);
 await record(page,"closed-panned",info.project.name,closed);
 const objects=page.getByRole("button",{name:"Objects",exact:true}).first();
 await action(objects,touch);const opened=await settled(page);await record(page,"drawer-open",info.project.name,opened);
 await action(objects,touch);const roundtrip=await settled(page);
 const comparison={beforePan,closed,opened,roundtrip,source,nativeSource:native.source,workerReceipts:context.workerReceipts,unchangedRange:JSON.stringify(closed.value.chartAudit.visible)===JSON.stringify(roundtrip.value.chartAudit.visible),unchangedAxis:closed.value.axis===roundtrip.value.axis,unchangedPrimary:closed.value.primary===roundtrip.value.primary};
 await record(page,"drawer-roundtrip",info.project.name,comparison);
 // Repeat near the left-history clamp using an ordinary pointer drag, never a chart API write.
 const edgeBox=(await canvas.boundingBox())!;
 await page.mouse.move(edgeBox.x+edgeBox.width*.05,edgeBox.y+edgeBox.height*.5);await page.mouse.down();await page.mouse.move(edgeBox.x+edgeBox.width*.95,edgeBox.y+edgeBox.height*.5,{steps:12});await page.mouse.up();
 const edgeClosed=await settled(page);await action(objects,touch);const edgeOpen=await settled(page);await action(objects,touch);const edgeRoundtrip=await settled(page);
 await record(page,"drawer-edge-roundtrip",info.project.name,{edgeClosed,edgeOpen,edgeRoundtrip,unchangedRange:JSON.stringify(edgeClosed.value.chartAudit.visible)===JSON.stringify(edgeRoundtrip.value.chartAudit.visible),unchangedAxis:edgeClosed.value.axis===edgeRoundtrip.value.axis,unchangedPrimary:edgeClosed.value.primary===edgeRoundtrip.value.primary});
 await action(objects,touch);await settled(page);
 const row=page.locator(".chart-object-row").filter({hasText:"Native Objects proof"}).first();await expect(row).toBeVisible();
 if(touch)await row.locator(".object-symbol-cell").tap();else await row.hover();
 const controls=await row.evaluate(r=>({caption:r.textContent,buttons:[...r.querySelectorAll("button")].map(b=>{const rect=b.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return{text:b.textContent,aria:b.getAttribute("aria-label"),bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},ownsHit:!!hit&&b.contains(hit),hit:hit?.outerHTML};})}));
 await record(page,"visibility-controls",info.project.name,controls);
 const toggle=row.getByRole("button",{name:"On",exact:true});let pointerError:string|null=null;
 try{if(touch)await toggle.tap({timeout:1500});else await toggle.click({timeout:1500});}catch(error){pointerError=String(error);}
 await record(page,"visibility-attempt",info.project.name,{controls,pointerError,after:await chartBitmap(page)});
 expect(errors,"No fixture or production page errors").toEqual([]);
 const worker=fs.readdirSync("frontend/dist/assets").find(n=>/^pine-native-worker.*\.js$/.test(n))!;
 const workerHash=createHash("sha256").update(fs.readFileSync(path.join("frontend/dist/assets",worker))).digest("hex");
 expect(context.workerReceipts.length).toBeGreaterThan(0);for(const r of context.workerReceipts)expect(r.sha256).toBe(workerHash);
});

async function ownedAction(page:Page,control:Locator,touch:boolean){
 await control.scrollIntoViewIfNeeded();const hit=await control.evaluate(button=>{const r=button.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{width:r.width,height:r.height,inViewport:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,ownsHit:!!target&&button.contains(target)};});
 expect(hit.width,"Control has44px minimum touch width").toBeGreaterThanOrEqual(44);expect(hit.height,"Control has44px minimum touch height").toBeGreaterThanOrEqual(44);expect(hit.inViewport).toBe(true);expect(hit.ownsHit,"Actual control owns the pointer target").toBe(true);
 await action(control,touch);
}
function sameContext(before:any,after:any,label:string){
 expect(after.chartAudit.visible,label+" keeps working logical interval").toEqual(before.chartAudit.visible);
 expect(after.chartAudit.scrollPosition,label+" keeps actual right offset").toBe(before.chartAudit.scrollPosition);
}
async function paneObservation(page:Page){
 return page.getByRole("region",{name:"Native Objects proof native Pine pane",exact:true}).evaluate(async section=>{
  const layers=[...section.querySelectorAll<HTMLCanvasElement>("canvas")],canvas=layers.filter(c=>c.getBoundingClientRect().height>50).sort((a,b)=>b.width-a.width)[0];if(!canvas)throw new Error("Actual native pane canvas missing");
  const data=canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data;let cyan=0;
  for(let i=0;i<data.length;i+=4)if(data[i]<50&&data[i+1]>150&&data[i+2]>150)cyan++;
  const r=canvas.getBoundingClientRect();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data))).map(v=>v.toString(16).padStart(2,"0")).join("");
  const anchor=(red:number,green:number,blue:number)=>{let total=0,x=0;for(let i=0;i<data.length;i+=4)if(data[i]===red&&data[i+1]===green&&data[i+2]===blue){total++;x+=(i/4)%canvas.width;}return total?{pixels:total,x:x/total}:null;};
  return{hash,anchors:[anchor(0,255,0),anchor(255,0,255)],width:canvas.width,height:canvas.height,cssWidth:r.width,cssHeight:r.height,cyan};
 });
}

async function frame(page:Page,subject:Locator,block:"start"|"center"="start"){await subject.evaluate((node,block)=>node.scrollIntoView({block,inline:"nearest",behavior:"instant"}),block);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function readableIdentity(page:Page,row:Locator,name:string,version:number){
 await row.scrollIntoViewIfNeeded();
 const proof=await row.evaluate(node=>[...node.querySelectorAll<HTMLElement>(".indicator-object-name,.indicator-object-caption")].map(element=>{
  const bounds=element.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(element);const textRects=[...range.getClientRects()].map(r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,ownsHit:element.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2))})),style=getComputedStyle(element);
  return{text:element.textContent,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,bounds:{left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom},textRects,textOverflow:style.textOverflow,whiteSpace:style.whiteSpace,inViewport:bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight};
 }));
 expect(proof.map(p=>p.text)).toEqual([name,expect.stringMatching(new RegExp("^Native Pine v"+version+" · revision [0-9]+$"))]);
 for(const item of proof){expect(item.inViewport,"Full native identity is visible").toBe(true);expect(item.scrollWidth,"Full native identity has no horizontal clipping").toBeLessThanOrEqual(item.clientWidth);expect(item.scrollHeight,"Full native identity has no vertical clipping").toBeLessThanOrEqual(item.clientHeight);expect(item.textOverflow).not.toBe("ellipsis");expect(item.textRects.length).toBeGreaterThan(0);for(const r of item.textRects){expect(r.ownsHit,"Actual native text is not obscured by fixed navigation or another control").toBe(true);expect(r.left).toBeGreaterThanOrEqual(item.bounds.left-1);expect(r.right).toBeLessThanOrEqual(item.bounds.right+1);expect(r.top).toBeGreaterThanOrEqual(item.bounds.top-1);expect(r.bottom).toBeLessThanOrEqual(item.bounds.bottom+1);}}
 return proof;
}

test("native Objects explicit touch keyboard settings preserve chart interval and study identity",async({page},info)=>{
 test.skip(!!process.env.EDGELAB_OBJECTS_BASELINE,"Baseline uses unchanged production43");test.setTimeout(120000);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));const touch=!!(info.project.use.hasTouch||info.project.use.isMobile),context=await fixture(page);
 const source='//@version=6\nindicator("Native Objects proof",overlay=false)\nlength=input.int(5,"Length")\nshade=input.color(#ff0000,"Shade")\nplot(ta.sma(close,length),color=#00ffff,title="Mean")\nplot(bar_index==64?close*1.01:na,color=#00ff00,style=plot.style_circles,title="Anchor64")\nplot(bar_index==72?close*.99:na,color=#ff00ff,style=plot.style_circles,title="Anchor72")\nbarcolor(shade,title="Body")';
 const editor=await openEditor(page);await editor.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");await fillSource(editor,source);await check(editor);await run(editor);const raw=await nativeRun(page,source);
 expect(raw.source).toBe(source);expect(raw.audit.engineVersion).toBe("0.11.0");
 await editor.getByRole("button",{name:"Save",exact:true}).click();await expect.poll(()=>((context.storage.get("custom-indicator-scripts.v1") as any[])??[]).some(s=>s.source===source)).toBe(true);
 await editor.getByRole("button",{name:"Add to chart",exact:true}).click();await editor.getByRole("button",{name:"Close indicator editor",exact:true}).click();
 const peerSource='//@version=5\nindicator("Native v5 peer",overlay=false)\nbarcolor(na,title="No override")';
 const peerEditor=await openEditor(page);await peerEditor.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");await fillSource(peerEditor,peerSource);await check(peerEditor);await run(peerEditor);expect((await nativeRun(page,peerSource)).source).toBe(peerSource);
 await peerEditor.getByRole("button",{name:"Save",exact:true}).click();await expect.poll(()=>((context.storage.get("custom-indicator-scripts.v1") as any[])??[]).some(s=>s.source===peerSource)).toBe(true);
 await peerEditor.getByRole("button",{name:"Add to chart",exact:true}).click();await peerEditor.getByRole("button",{name:"Close indicator editor",exact:true}).click();
 const saved=structuredClone(context.storage.get("custom-indicator-scripts.v1"));
 const pane=page.getByRole("region",{name:"Native Objects proof native Pine pane",exact:true});await expect(pane).toBeVisible();await settled(page);
 const canvas=page.locator(".chart-stage canvas").first();await canvas.scrollIntoViewIfNeeded();const beforePan=await settled(page),box=(await canvas.boundingBox())!;
 const drag={x:box.x+box.width*.55,y:Math.max(box.y+20,Math.min(box.y+box.height*.5,150))},viewport=page.viewportSize()!;
 const ownership=await page.locator(".chart-stage").first().evaluate((stage,points)=>points.map(p=>{const target=document.elementFromPoint(p.x,p.y);return{point:p,ownsHit:!!target&&stage.contains(target),target:target?.outerHTML.slice(0,300)};}),[drag,{x:drag.x+80,y:drag.y}]);
 for(const point of ownership)expect(point.ownsHit,"Actual chart owns drag endpoint "+JSON.stringify(point)).toBe(true);
 expect(drag.x).toBeGreaterThanOrEqual(box.x);expect(drag.x+80).toBeLessThan(Math.min(box.x+box.width,viewport.width));expect(drag.y).toBeGreaterThanOrEqual(0);expect(drag.y).toBeLessThan(Math.min(box.y+box.height,viewport.height));
 await page.mouse.move(drag.x,drag.y);await page.mouse.down();await page.mouse.move(drag.x+80,drag.y,{steps:8});await page.mouse.up();
 const closed=await settled(page);expect(closed.value.axis,"Real manual pan changes dates").not.toBe(beforePan.value.axis);const closedPane=await paneObservation(page);expect(closedPane.cyan).toBeGreaterThan(0);
 const objects=page.getByRole("button",{name:"Objects",exact:true}).first();await action(objects,touch);
 const opened=await settled(page),openPane=await paneObservation(page);sameContext(closed.value,opened.value,"Opening drawer");expect(openPane.cyan).toBeGreaterThan(0);
 for(let i=0;i<2;i++){expect(closedPane.anchors[i],"Known source anchor paints in closed pane").not.toBeNull();expect(openPane.anchors[i],"Known source anchor paints in open pane").not.toBeNull();const expected=closedPane.anchors[i]!.x/closedPane.width*openPane.width;expect(Math.abs(openPane.anchors[i]!.x-expected),"Pane source anchor scales with preserved own time context").toBeLessThanOrEqual(2);}
 await frame(page,canvas,"center");expect((await chartBitmap(page)).axis).toBe(opened.value.axis);
 await record(page,"final-drawer-open",info.project.name,{closed,opened,closedPane,openPane});
 await frame(page,page.getByRole("complementary",{name:"Chart objects",exact:true}));expect((await chartBitmap(page)).axis).toBe(opened.value.axis);
 await record(page,"final-drawer-controls-open",info.project.name,{opened});
 await action(objects,touch);const roundtrip=await settled(page),roundtripPane=await paneObservation(page);sameContext(closed.value,roundtrip.value,"Closing drawer");
 expect(roundtrip.value.primary,"Roundtrip keeps exact primary pixels").toBe(closed.value.primary);expect(roundtrip.value.axis,"Roundtrip keeps exact dates").toBe(closed.value.axis);expect(roundtrip.value.chartAudit.anchors).toEqual(closed.value.chartAudit.anchors);
 expect(roundtripPane.width).toBe(closedPane.width);expect(roundtripPane.height).toBe(closedPane.height);expect(roundtripPane.cyan).toBe(closedPane.cyan);expect(roundtripPane.hash,"Native pane roundtrip keeps exact own pixels").toBe(closedPane.hash);
 await frame(page,canvas,"center");expect((await chartBitmap(page)).axis).toBe(roundtrip.value.axis);
 await record(page,"final-drawer-roundtrip",info.project.name,{closed,opened,roundtrip,closedPane,openPane,roundtripPane});
 await frame(page,pane,"center");expect((await paneObservation(page)).hash).toBe(roundtripPane.hash);
 await record(page,"final-native-pane",info.project.name,{roundtripPane});
 await action(objects,touch);await settled(page);const row=page.locator(".indicator-object-row").filter({hasText:"Native Objects proof"}).first();await expect(row).toContainText("Native Pine v6");await expect(row).not.toContainText("EdgeLab DSL");
 const trigger=row.getByRole("button",{name:"Settings for Native Objects proof",exact:true});await expect(trigger).toHaveAttribute("aria-expanded","false");
 const settings=row.locator(".indicator-object-settings");await expect(settings).toBeHidden();
 const names=()=>page.locator(".indicator-object-row").filter({hasText:/Native Pine v[56] · revision/}).locator(".indicator-object-name").allTextContents();
 const identityBefore=await names();expect(identityBefore).toEqual(["Native Objects proof","Native v5 peer"]);
 const peerRow=page.locator(".indicator-object-row").filter({hasText:"Native v5 peer"});await expect(peerRow).toContainText("Native Pine v5");await expect(peerRow).not.toContainText("EdgeLab DSL");
 const identityProof=[await readableIdentity(page,row,"Native Objects proof",6),await readableIdentity(page,peerRow,"Native v5 peer",5)];await record(page,"final-readable-native-identity",info.project.name,{identityBefore,identityProof});
 await ownedAction(page,trigger,touch);await expect(trigger).toHaveAttribute("aria-expanded","true");await expect(settings).toBeVisible();
 await settings.getByRole("spinbutton",{name:"Length",exact:true}).fill("8");await settings.getByRole("textbox",{name:"Shade",exact:true}).fill("#0000ff");
 await expect.poll(()=>page.evaluate(source=>(window as any).__nativeEditorResults.some((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source&&r.result.inputs.in_0===8&&r.result.inputs.in_1==="#0000ff"),source)).toBe(true);
 const edited=await settled(page);expect(edited.value.blue).toBeGreaterThan(0);sameContext(opened.value,edited.value,"Input rerun");await expect(settings).not.toContainText("Period");expect(await names()).toEqual(identityBefore);
 await record(page,"final-native-settings",info.project.name,{identityBefore,edited,source,caption:await row.textContent()});
 const close=row.getByRole("button",{name:"Close settings for Native Objects proof",exact:true});await ownedAction(page,close,touch);await expect(settings).toBeHidden();await expect(trigger).toBeFocused();
 await trigger.press("Enter");await expect(settings).toBeVisible();await close.focus();await page.keyboard.press("Escape");await expect(settings).toBeHidden();await expect(trigger).toBeFocused();
 const playback=page.locator('[data-ui-panel="replay-transport"]').getByRole("button",{name:/^(Play|Pause)$/,includeHidden:true});await expect(playback).toHaveCount(1);const playbackBefore=(await playback.textContent())!.trim();
 await trigger.press("Space");await expect(settings).toBeVisible();await expect(playback,"Settings Space must not toggle replay playback").toHaveText(playbackBefore);await ownedAction(page,close,touch);
 await ownedAction(page,row.getByRole("button",{name:"On: Hide Native Objects proof",exact:true}),touch);await expect(pane).toHaveCount(0);await settled(page);
 await ownedAction(page,row.getByRole("button",{name:"Off: Show Native Objects proof",exact:true}),touch);await expect(pane).toBeVisible();const shown=await settled(page);sameContext(edited.value,shown.value,"Hide/Show");
 expect(shown.value.primary,"Show restores exact edited primary pixels").toBe(edited.value.primary);expect(shown.value.axis).toBe(edited.value.axis);
 await record(page,"final-visibility",info.project.name,{edited,shown});
 await ownedAction(page,trigger,touch);await ownedAction(page,row.getByRole("button",{name:"Remove Native Objects proof",exact:true}),touch);await expect(row).toHaveCount(0);await expect(pane).toHaveCount(0);await expect(peerRow.getByRole("button",{name:"Settings for Native v5 peer",exact:true})).toBeFocused();
 const removed=await settled(page);sameContext(shown.value,removed.value,"Removal");expect(removed.value.axis).toBe(shown.value.axis);expect(removed.value.blue).toBe(0);
 expect(context.storage.get("custom-indicator-scripts.v1")).toEqual(saved);expect(errors).toEqual([]);
 const worker=fs.readdirSync("frontend/dist/assets").find(n=>/^pine-native-worker.*\.js$/.test(n))!,workerHash=createHash("sha256").update(fs.readFileSync(path.join("frontend/dist/assets",worker))).digest("hex");
 expect(context.workerReceipts.length).toBeGreaterThan(0);for(const r of context.workerReceipts)expect(r.sha256).toBe(workerHash);
 await record(page,"final-removed",info.project.name,{removed,source,saved,workerHash,workerReceipts:context.workerReceipts});
 const chartStage=page.locator(".chart-stage").first();await chartStage.focus();await expect(chartStage).toBeFocused();
 await page.keyboard.press("Space");await expect(playback,"Ordinary chart Space retains replay shortcut").toHaveText(playbackBefore==="Play"?"Pause":"Play");
 await page.keyboard.press("Space");await expect(playback).toHaveText(playbackBefore);await settled(page);expect(errors).toEqual([]);
 await record(page,"final-replay-shortcut",info.project.name,{playbackBefore,playbackAfter:(await playback.textContent())!.trim(),workerReceipts:context.workerReceipts,workerHash});
});
