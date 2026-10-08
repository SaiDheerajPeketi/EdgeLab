import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { betaSessionResponse, FROZEN_TIME, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";
import { bars, fulfillReplayContext } from "./support/replay-context";

async function fixture(page: Page) {
  await installDeterminism(page);
  await seedApprovedSession(page);
  await fulfillReplayContext(page);
  const storage = new Map<string, any>();
  const writes: Array<{key:string;value:any}> = [];
  const receipts = new Map<string, any>();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const seeded = {chartStyle:"candles",drawings:[
    {id:"audit-fib",tool:"fib",label:"Audit Fib",color:"#32d3ee",createdAt:"2026-09-15T08:00:00Z",points:[{time:bars[70].time,price:67900},{time:bars[80].time,price:68200}]},
    {id:"audit-line",tool:"horizontal",label:"Audit Line",color:"#ffbe55",createdAt:"2026-09-15T08:01:00Z",points:[{time:bars[70].time,price:68000}]}
  ],indicatorInstances:[],magnetMode:"off",paneLayout:"single",schemaVersion:2,settingsDefaultsVersion:2,showOrderOverlays:true,smoothCandles:false,timeframe:"5m"};
  storage.set("chart-layout.v1",seeded);
  await page.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/session") {
      await route.fulfill({json:betaSessionResponse}); return;
    }
    const metadata = endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (metadata) {
      const [,id,action] = metadata;
      if (action === "reserve") receipts.set(id,{operation_id:id,...request.postDataJSON(),status:"reserved",http_status:null,result:null,created_at:FROZEN_TIME,completed_at:null});
      await route.fulfill({json:receipts.get(id)}); return;
    }
    const bound = request.headers()["x-edgelab-operation-id"];
    if (bound && receipts.has(bound)) Object.assign(receipts.get(bound),{status:"completed",http_status:200,completed_at:FROZEN_TIME});
    if (endpoint === "/settings/chart/presets" && request.method() === "POST") {
      const command = request.postDataJSON();
      const key = command.kind === "drawing" ? "drawing-presets.v1" : "fib-presets.v1";
      const previous = storage.get(key) ?? [];
      const normalized = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
      const value = command.action === "delete" ? previous.filter((item: any) => item.id !== command.id) : [command.preset, ...previous.filter((item: any) => item.id !== command.preset.id && !(normalized(item.name) === normalized(command.preset.name) && (command.kind !== "drawing" || item.tool === command.preset.tool)))];
      storage.set(key, value); writes.push({key, value: structuredClone(value)});
      await route.fulfill({json: {namespace: "edgelab", key, value, updated_at: FROZEN_TIME}}); return;
    }
    const storageKey = endpoint.match(/^\/app-storage\/edgelab\/(.+)$/)?.[1];
    if (storageKey) {
      const decoded = decodeURIComponent(storageKey);
      if (request.method() === "PUT") {
        storage.set(decoded,request.postDataJSON().value);
        writes.push({key:decoded,value:structuredClone(storage.get(decoded))});
      }
      await route.fulfill({json:{namespace:"edgelab",key:decoded,value:storage.get(decoded)??null,updated_at:FROZEN_TIME}}); return;
    }
    await route.fallback();
  });
  await gotoStable(page,"/app/replay",{waitForNetworkIdle:false});
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  await page.getByRole("button",{name:"Objects",exact:true}).first().click();
  await expect(page.locator(".drawing-object-row").filter({hasText:"Audit Fib"})).toBeVisible();
  return {storage,writes,errors};
}

async function openFib(page: Page) {
  const row=page.locator(".drawing-object-row").filter({hasText:"Audit Fib"});
  await row.focus(); await row.press("Enter");
  await expect(row).toHaveClass(/chart-object-row-selected/);
  // Genuine SVG anchor click waits for the drawing to settle after the Objects pane opens.
  await page.locator('.chart-stage .drawing-anchor-group circle[fill="transparent"]').first().click();
  const toolbar = page.getByRole("group",{name:"Drawing settings",exact:true});
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("spinbutton",{name:"Fib ratio",exact:true}).first()).toBeVisible();
  return toolbar;
}





const artifacts=path.resolve(".artifacts/drawing-presets99");
async function geometry(locator:any){return locator.evaluate((el:HTMLElement)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewport:{width:innerWidth,height:innerHeight},background:s.backgroundColor,overflow:s.overflow}});}
async function hit(locator:any){return locator.evaluate((el:HTMLElement)=>{const r=el.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {reachable:target===el||!!target&&el.contains(target),target:target?.tagName,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}});}
const presetName=(kind:string,n:number)=>kind+" zone "+String(n).padStart(2,"0");

for(const kind of ["Drawing","Fib"] as const)test(kind+" presets use reachable keyboard menus and acknowledged real saved presets",async({page},info)=>{
 const state=await fixture(page);
 const row=page.locator(".drawing-object-row").nth(kind==="Drawing"?1:0);
 let toolbar:any;
 if(kind==="Fib")toolbar=await openFib(page);
 else{
  await row.focus();await row.press("Enter");
  await page.locator('.chart-stage .drawing-anchor-group circle[fill="transparent"]').first().click();
  toolbar=page.getByRole("group",{name:"Drawing settings",exact:true});await expect(toolbar).toBeVisible();
 }
 const input=kind==="Drawing"?toolbar.getByRole("textbox",{name:"Drawing label",exact:true}):toolbar.getByRole("textbox",{name:"Fib preset name",exact:true});
 const save=toolbar.getByTitle(kind==="Drawing"?"Save label/style preset":"Save fib preset",{exact:true});
 const storageKey=kind==="Drawing"?"drawing-presets.v1":"fib-presets.v1";
 for(let i=1;i<=12;i++){
  await input.fill(presetName(kind,i));
  if(kind==="Fib")await toolbar.getByRole("spinbutton",{name:"Fib ratio",exact:true}).first().fill(String(i/100));
  await save.click();await expect.poll(()=>state.storage.get(storageKey)?.length).toBe(i);
 }
 const saved=structuredClone(state.storage.get(storageKey));
 expect(saved.map((p:any)=>p.name)).toEqual(Array.from({length:12},(_,i)=>presetName(kind,12-i)));
 const trigger=toolbar.getByRole("button",{name:kind+" presets",exact:true});
 const menu=page.getByRole("menu",{name:kind+" presets",exact:true});
 const apply=(n:number)=>menu.getByRole("menuitemradio",{name:"Apply "+presetName(kind,n),exact:true});
 const remove=(n:number)=>menu.getByRole("menuitem",{name:"Delete "+presetName(kind,n),exact:true});
 const assertApplied=async(n:number)=>{
  await expect(menu).toBeHidden();await expect(toolbar).toBeVisible();await expect(trigger).toBeFocused();
  await expect.poll(()=>{const d=state.storage.get("chart-layout.v1")?.drawings.find((d:any)=>d.id===(kind==="Drawing"?"audit-line":"audit-fib"));return kind==="Drawing"?d?.label:d?.fibLevels?.[0]?.value;}).toBe(kind==="Drawing"?presetName(kind,n):n/100);
 };

 await trigger.focus();await trigger.press("ArrowDown");
 await expect(menu).toBeVisible();await expect(apply(12)).toBeFocused();await expect(apply(12)).toHaveAttribute("aria-checked","true");
 await expect(menu.getByRole("menuitemradio")).toHaveCount(12);await expect(menu.getByRole("menuitem")).toHaveCount(12);
 await apply(12).press("ArrowDown");await expect(remove(12)).toBeFocused();
 await remove(12).press("ArrowDown");await expect(apply(11)).toBeFocused();
 await apply(11).press("ArrowUp");await expect(remove(12)).toBeFocused();
 await remove(12).press("Home");await expect(apply(12)).toBeFocused();
 await apply(12).press("End");await expect(remove(1)).toBeFocused();
 const receipt:any={kind,saved,menu:await geometry(menu),lastHit:await hit(apply(1)),deleteHit:await hit(remove(1))};
 expect(receipt.lastHit.reachable).toBe(true);expect(receipt.deleteHit.reachable).toBe(true);
 expect(receipt.menu.x).toBeGreaterThanOrEqual(0);expect(receipt.menu.y).toBeGreaterThanOrEqual(0);
 expect(receipt.menu.right).toBeLessThanOrEqual(receipt.menu.viewport.width+1);expect(receipt.menu.bottom).toBeLessThanOrEqual(receipt.menu.viewport.height+1);
 if(info.project.name==="mobile"){expect(receipt.lastHit.rect.height).toBeGreaterThanOrEqual(44);expect(receipt.deleteHit.rect.width).toBeGreaterThanOrEqual(44);expect(receipt.deleteHit.rect.height).toBeGreaterThanOrEqual(44);}
 fs.mkdirSync(artifacts,{recursive:true});
 const capture=path.join(artifacts,"final-"+info.project.name+"-"+kind.toLowerCase()+".png");
 if(process.env.EDGELAB_PRESETS99_CAPTURE!=="0"&&!fs.existsSync(capture))await page.screenshot({path:capture,animations:"disabled"});
 await apply(1).click();await assertApplied(1);

 await trigger.press("ArrowDown");await expect(apply(1)).toBeFocused();
 await apply(1).press("Escape");await expect(menu).toBeHidden();await expect(trigger).toBeFocused();await expect(toolbar).toBeVisible();
 await trigger.press("ArrowUp");await expect(apply(1)).toBeFocused();
 await apply(1).press("Home");await expect(apply(12)).toBeFocused();
 await apply(12).pressSequentially(presetName(kind,7));await expect(apply(7)).toBeFocused();
 await apply(7).press("Enter");await assertApplied(7);
 if(kind==="Drawing"){await input.fill("Scratch draft");await expect.poll(()=>state.storage.get("chart-layout.v1")?.drawings.find((d:any)=>d.id==="audit-line")?.label).toBe("Scratch draft");}
 else{await toolbar.getByRole("spinbutton",{name:"Fib ratio",exact:true}).first().fill("0.09");await expect.poll(()=>state.storage.get("chart-layout.v1")?.drawings.find((d:any)=>d.id==="audit-fib")?.fibLevels?.[0]?.value).toBe(.09);}
 await trigger.press("ArrowDown");await expect(apply(7)).toBeFocused();
 await apply(7).press("Space");await assertApplied(7);


 await trigger.press("ArrowDown");await expect(apply(7)).toBeFocused();
 await apply(7).press("Tab");await expect(menu).toBeHidden();await expect(save).toBeFocused();
 await trigger.focus();await trigger.press("ArrowDown");await expect(apply(7)).toBeFocused();
 await apply(7).press("Shift+Tab");await expect(menu).toBeHidden();await expect(input).toBeFocused();
 await trigger.click();await expect(apply(7)).toBeFocused();
 const outside=toolbar.getByTitle("dashed line",{exact:true});
 receipt.outsideHit=await hit(outside);expect(receipt.outsideHit.reachable).toBe(true);
 await outside.click();await expect(menu).toBeHidden();await expect(toolbar).toBeVisible();

 await trigger.press("ArrowDown");await remove(1).click();
 await expect.poll(()=>state.storage.get(storageKey)?.length).toBe(11);
 await expect(apply(2)).toBeFocused();await expect(menu).toBeVisible();
 for(let i=2;i<=12;i++){
  await remove(i).press("Enter");
  await expect.poll(()=>state.storage.get(storageKey)?.length).toBe(12-i);
  if(i<12){await expect(menu).toBeVisible();await expect(apply(i+1)).toBeFocused();}
 }
 await expect(menu).toBeHidden();await expect(trigger).toBeDisabled();await expect(trigger).toHaveAttribute("aria-expanded","false");await expect(save).toBeFocused();await expect(toolbar).toBeVisible();
 expect(state.errors).toEqual([]);
 receipt.errors=state.errors;receipt.finalStorage=state.storage.get(storageKey);receipt.finalFocus=await save.getAttribute("title");
 receipt.writes=state.writes.filter(w=>w.key===storageKey).length;
 fs.writeFileSync(path.join(artifacts,"final-"+info.project.name+"-"+kind.toLowerCase()+".json"),JSON.stringify(receipt,null,2));
});
