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
    {id:"audit-line",tool:"horizontal",label:"Audit Line",color:"#ffbe55",createdAt:"2026-09-15T08:01:00Z",points:[{time:bars[70].time,price:67500}]}
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



const artifacts = path.resolve(".artifacts/theme-workspace98");

async function geometry(locator: any) {
 return locator.evaluate((el: HTMLElement) => {
  const r=el.getBoundingClientRect(),s=getComputedStyle(el);
  return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,background:s.backgroundColor,color:s.color,opacity:s.opacity,viewport:{width:innerWidth,height:innerHeight}};
 });
}
async function hit(locator:any) {
 return locator.evaluate((el:HTMLElement)=>{
  const r=el.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
  return {reachable:target===el||!!target&&el.contains(target),target:target?.tagName,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
 });
}
function contained(r:any,label:string) {
 expect(r.x,label+" left").toBeGreaterThanOrEqual(0);
 expect(r.y,label+" top").toBeGreaterThanOrEqual(0);
 expect(r.right,label+" right").toBeLessThanOrEqual(r.viewport.width+1);
 expect(r.bottom,label+" bottom").toBeLessThanOrEqual(r.viewport.height+1);
}

test("Actual Objects controls and chart drawing menus remain themed, reachable and contained",async({page},info)=>{
 const state=await fixture(page),receipt:any={browserScheme:info.project.use.colorScheme};
 fs.mkdirSync(artifacts,{recursive:true});
 const row=page.locator(".drawing-object-row").nth(0);
 const trigger=row.getByRole("button",{name:"Settings for drawing Audit Fib",exact:true});
 await trigger.click();
 const popupId=await trigger.getAttribute("aria-controls");
 expect(popupId).toBeTruthy();
 const popup=page.locator('[id="'+popupId+'"]');
 await expect(popup).toHaveAttribute("role","dialog");
 await expect(popup).toHaveAccessibleName("Drawing settings for Audit Fib");
 receipt.settingsTrigger=await geometry(trigger);
 if(info.project.name.startsWith("mobile")){expect(receipt.settingsTrigger.width).toBeGreaterThanOrEqual(44);expect(receipt.settingsTrigger.height).toBeGreaterThanOrEqual(44);}
 const layerButtons=popup.getByRole("button",{name:/^(Send to back|Move backward|Move forward|Bring to front):/});
 await expect(layerButtons).toHaveCount(4);
 receipt.layerButtons=[];
 for(let i=0;i<4;i++){
  const action=layerButtons.nth(i);await action.scrollIntoViewIfNeeded();
  const measurement=await geometry(action),target=await hit(action);
  expect(target.reachable,"layer action "+i).toBe(true);
  if(info.project.name.startsWith("mobile")){expect(measurement.width).toBeGreaterThanOrEqual(44);expect(measurement.height).toBeGreaterThanOrEqual(44);}
  receipt.layerButtons.push({label:await action.getAttribute("aria-label"),...measurement,target});
 }
 await expect(popup).toBeVisible();
 await expect.poll(async()=>{const r=await geometry(popup);return r.x>=0&&r.y>=0&&r.right<=r.viewport.width+1&&r.bottom<=r.viewport.height+1;}).toBe(true);
 receipt.objects=await geometry(popup);contained(receipt.objects,"Objects settings");
 const deletion=popup.getByRole("button",{name:"Delete",exact:true});
 await deletion.scrollIntoViewIfNeeded();
 receipt.deleteHit=await hit(deletion);expect(receipt.deleteHit.reachable).toBe(true);
 const label=popup.getByRole("textbox",{name:"Label",exact:true});
 await label.fill("Entry");await label.press("End");await label.press("Space");await label.pressSequentially("zone");
 await expect(label).toHaveValue("Entry zone");
 await expect.poll(()=>state.storage.get("chart-layout.v1")?.drawings.find((d:any)=>d.id==="audit-fib")?.label).toBe("Entry zone");
 await label.fill("Audit Fib");
 const style=popup.getByRole("combobox",{name:"Drawing line style",exact:true});
 await style.click();
 const menu=page.getByRole("listbox",{name:"Drawing line style",exact:true});
 await expect(menu).toBeVisible();contained(await geometry(menu),"Objects style menu");
 await menu.getByRole("option",{name:"Dotted",exact:true}).click();
 await expect.poll(()=>state.storage.get("chart-layout.v1")?.drawings.find((d:any)=>d.id==="audit-fib")?.lineStyle).toBe("dotted");
 await style.click();await style.press("Escape");
 await expect(menu).toBeHidden();await expect(style).toBeFocused();await expect(popup).toBeVisible();
 await page.evaluate(()=>{document.body.style.setProperty("--ui-floating","rgb(39, 53, 69)");document.body.style.setProperty("--text-primary","rgb(231, 241, 249)");});
 receipt.sentinelObjects=await geometry(popup);
 expect(receipt.sentinelObjects.background).toBe("rgb(39, 53, 69)");
 expect(receipt.sentinelObjects.color).toBe("rgb(231, 241, 249)");
 await page.evaluate(()=>{document.body.style.removeProperty("--ui-floating");document.body.style.removeProperty("--text-primary");});
 await page.screenshot({path:path.join(artifacts,"final-"+info.project.name+"-objects.png"),animations:"disabled"});
 await style.press("Escape");
 await expect(popup).toBeHidden();await expect(trigger).toBeFocused();
 await trigger.click();await expect(popup).toBeVisible();
 await popup.getByRole("button",{name:"Close settings for drawing Audit Fib",exact:true}).click();
 await expect(popup).toBeHidden();await expect(trigger).toBeFocused();

 const toolbar=await openFib(page);
 await page.locator(".chart-stage").first().scrollIntoViewIfNeeded();
 receipt.toolbar=await geometry(toolbar);contained(receipt.toolbar,"Fib toolbar");
 await page.evaluate(()=>{document.body.style.setProperty("--ui-floating","rgb(39, 53, 69)");document.body.style.setProperty("--text-primary","rgb(231, 241, 249)");});
 receipt.sentinelToolbar=await geometry(toolbar);
 expect(receipt.sentinelToolbar.background).toBe("rgb(39, 53, 69)");
 expect(receipt.sentinelToolbar.color).toBe("rgb(231, 241, 249)");
 await page.evaluate(()=>{document.body.style.removeProperty("--ui-floating");document.body.style.removeProperty("--text-primary");});
 const fibStyle=toolbar.getByRole("combobox",{name:"Fib level line style",exact:true}).last();
 await fibStyle.scrollIntoViewIfNeeded();await fibStyle.click();
 const fibMenu=page.getByRole("listbox",{name:"Fib level line style",exact:true});
 await expect(fibMenu).toBeVisible();receipt.fibMenu=await geometry(fibMenu);contained(receipt.fibMenu,"Fib style menu");
 const lastOption=fibMenu.getByRole("option").last();
 receipt.fibOptionHit=await hit(lastOption);expect(receipt.fibOptionHit.reachable).toBe(true);
 await page.screenshot({path:path.join(artifacts,"final-"+info.project.name+"-fib-menu.png"),animations:"disabled"});
 await lastOption.click();
 await expect.poll(()=>state.storage.get("chart-layout.v1")?.drawings.find((d:any)=>d.id==="audit-fib")?.fibLevels?.at(-1)?.lineStyle).toBe("dotted");
 await fibStyle.click();await fibStyle.press("ArrowUp");await fibStyle.press("Enter");
 await expect(fibMenu).toBeHidden();await expect(fibStyle).toBeFocused();
 await expect.poll(()=>state.storage.get("chart-layout.v1")?.drawings.find((d:any)=>d.id==="audit-fib")?.fibLevels?.at(-1)?.lineStyle).toBe("dashed");
 receipt.chartSpace=await page.locator(".chart-stage").first().evaluate((el:HTMLElement)=>{
  const rect=(el:Element)=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
  const header=el.querySelector(".chart-stage-header");
  return {stage:rect(el),canvases:Array.from(el.querySelectorAll("canvas")).map(rect),header:header?{rect:rect(header),children:Array.from(header.children).map(rect)}:null};
 });
 await page.getByRole("button",{name:"Tools",exact:true}).first().click();
 await page.getByRole("button",{name:"Quick wheel",exact:false}).first().click();
 const wheel=page.getByRole("dialog",{name:"Circular toolbox favorites",exact:true});
 await expect(wheel).toBeVisible();receipt.wheel=await geometry(wheel);contained(receipt.wheel,"Quick wheel");
 await page.screenshot({path:path.join(artifacts,"final-"+info.project.name+"-wheel.png"),animations:"disabled"});
 await wheel.press("Escape");await expect(wheel).toBeHidden();
 receipt.errors=state.errors;expect(state.errors).toEqual([]);
 receipt.persistedFib=state.storage.get("chart-layout.v1")?.drawings.find((d:any)=>d.id==="audit-fib");
 expect(state.writes.some(w=>w.key==="chart-layout.v1"&&w.value.drawings?.some((d:any)=>d.id==="audit-fib"&&d.label==="Entry zone"))).toBe(true);
 fs.writeFileSync(path.join(artifacts,"final-"+info.project.name+".json"),JSON.stringify(receipt,null,2));
});
