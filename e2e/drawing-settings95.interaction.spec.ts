import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { betaSessionResponse, FROZEN_TIME, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";
import { bars, fulfillReplayContext } from "./support/replay-context";

const key = "edgelab.chart-layout.v1.user-7001";
const artifacts = path.resolve(".artifacts/drawing-settings95");
const stores=new WeakMap<Page,Map<string,any>>();
const innerHeightFor=(g:{viewport:{height:number}})=>g.viewport.height;


async function fixture(page: Page) {
  await installDeterminism(page);
  await seedApprovedSession(page);
  await fulfillReplayContext(page);
  const storage = new Map<string, any>();
  stores.set(page,storage);
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

async function layout(page: Page) {
  return structuredClone(stores.get(page)!.get("chart-layout.v1"));
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

test("Label accepts ordinary Space without selecting its parent drawing row",async ({page},info) => {
  const state = await fixture(page);
  const row = page.locator(".drawing-object-row").nth(0);
  await expect(row).toContainText("Audit Fib");
  await row.getByRole("button",{name:"Settings for drawing Audit Fib",exact:true}).click();
  const popupId = await row.getByRole("button",{name:"Settings for drawing Audit Fib",exact:true}).getAttribute("aria-controls");
  const label = page.locator(`[id="${popupId}"]`).getByRole("textbox",{name:"Label",exact:true});
  await label.fill("Entry"); await label.press("End"); await label.press("Space"); await label.pressSequentially("zone");
  await expect(label).toHaveValue("Entry zone");
  await expect.poll(async()=> (await layout(page)).drawings.find((d:any)=>d.id==="audit-fib").label).toBe("Entry zone");
  await expect.poll(()=>state.writes.some(w=>JSON.stringify(w.value).includes("Entry zone"))).toBe(true);
  fs.mkdirSync(artifacts,{recursive:true});
  fs.writeFileSync(path.join(artifacts,`final-${info.project.name}-label.json`),JSON.stringify({layout:await layout(page),writes:state.writes,errors:state.errors},null,2));
  expect(state.errors).toEqual([]);
});

test("Clearing a Fib ratio preserves its applied value and Escape restores it",async ({page},info) => {
  const state=await fixture(page);
  const toolbar=await openFib(page);
  fs.mkdirSync(artifacts,{recursive:true});
  const measure=()=>toolbar.evaluate(el=>{const r=el.getBoundingClientRect(); const parent=(el as HTMLElement).offsetParent?.getBoundingClientRect();const nav=document.querySelector('nav[aria-label="Primary workspace"]')?.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,parent:parent?{x:parent.x,y:parent.y,width:parent.width,height:parent.height}:null,nav:nav?{top:nav.top,height:nav.height}:null,viewport:{width:innerWidth,height:innerHeight},scrollWidth:el.scrollWidth,clientWidth:el.clientWidth};});
  const initial=await measure();
  const geometryReceipt:any={initial};
  if(info.project.name==="mobile"){
    await page.locator(".chart-stage").first().scrollIntoViewIfNeeded();
    await expect.poll(async()=>{const g=await measure();return g.y>=Math.max(0,g.parent?.y??0)-1&&g.bottom<=Math.min(innerHeightFor(g),g.nav?.top??Infinity)+1;}).toBe(true);
    geometryReceipt.initial=await measure();
    await page.screenshot({path:path.join(artifacts,"mobile-initial-geometry.png"),animations:"disabled"});
    await page.setViewportSize({width:390,height:620});
    await page.locator(".chart-stage").first().scrollIntoViewIfNeeded();
    await expect.poll(async()=>{const g=await measure();return g.y>=Math.max(0,g.parent?.y??0)-1&&g.bottom<=Math.min(innerHeightFor(g),g.nav?.top??Infinity)+1;}).toBe(true);
    geometryReceipt.short=await measure();
    await page.screenshot({path:path.join(artifacts,"mobile-short-geometry.png"),animations:"disabled"});
    await page.setViewportSize({width:390,height:844});
  }
  fs.writeFileSync(path.join(artifacts,`geometry-${info.project.name}.json`),JSON.stringify(geometryReceipt,null,2));
  const ratio=toolbar.getByRole("spinbutton",{name:"Fib ratio",exact:true}).nth(3);
  await expect(ratio).toHaveValue("0.5");
  const before=(await layout(page)).drawings.find((d:any)=>d.id==="audit-fib");
  await ratio.fill("");
  await expect(ratio).toHaveValue("");
  expect((await layout(page)).drawings.find((d:any)=>d.id==="audit-fib")).toEqual(before);
  const writeCount=state.writes.length;
  await ratio.press("Enter");
  await expect(ratio).toHaveAttribute("aria-invalid","true");
  await ratio.fill("4.237");
  await expect(ratio).toHaveAttribute("aria-invalid","true");
  await ratio.fill("-2.001");
  await expect(ratio).toHaveAttribute("aria-invalid","true");
  await ratio.fill(""); await ratio.pressSequentially("-");
  await expect(ratio).toHaveAttribute("aria-invalid","true");
  expect((await layout(page)).drawings.find((d:any)=>d.id==="audit-fib")).toEqual(before);
  expect(state.writes.length).toBe(writeCount);
  fs.mkdirSync(artifacts,{recursive:true});
  const warning=toolbar.locator('[role="alert"]');
  await warning.scrollIntoViewIfNeeded();
  const warningBox=await warning.boundingBox(); const toolbarBox=await toolbar.boundingBox();
  const numericBounds=await ratio.evaluate(el=>{const input=el.getBoundingClientRect();const wrapper=el.parentElement!.getBoundingClientRect();const next=el.parentElement!.nextElementSibling!.getBoundingClientRect();return {inputRight:input.right,wrapperRight:wrapper.right,nextLeft:next.left};});
  expect(numericBounds.inputRight).toBeLessThanOrEqual(numericBounds.wrapperRight+1);
  expect(warningBox!.x+warningBox!.width).toBeLessThanOrEqual(numericBounds.wrapperRight+1);
  expect(numericBounds.wrapperRight).toBeLessThanOrEqual(numericBounds.nextLeft-1);
  fs.writeFileSync(path.join(artifacts,`numeric-bounds-${info.project.name}.json`),JSON.stringify({numericBounds,warningBox},null,2));
  expect(warningBox!.x).toBeGreaterThanOrEqual(toolbarBox!.x);
  expect(warningBox!.x+warningBox!.width).toBeLessThanOrEqual(toolbarBox!.x+toolbarBox!.width+1);
  expect(warningBox!.y+warningBox!.height).toBeLessThanOrEqual(toolbarBox!.y+toolbarBox!.height+1);
  await page.screenshot({path:path.join(artifacts,`final-${info.project.name}-invalid.png`),animations:"disabled"});
  await ratio.press("Escape"); await expect(ratio).toHaveValue("0.5");
  await expect(toolbar).toBeVisible();
  const original=await ratio.elementHandle();
  await original!.fill("-0.125");
  await expect.poll(async()=> (await layout(page)).drawings.find((d:any)=>d.id==="audit-fib").fibLevels?.find((l:any)=>l.id==="05")?.value).toBe(-0.125);
  await original!.fill("0.735");
  await expect.poll(async()=> (await layout(page)).drawings.find((d:any)=>d.id==="audit-fib").fibLevels?.find((l:any)=>l.id==="05")?.value).toBe(0.735);
  await expect.poll(()=>state.writes.some(w=>JSON.stringify(w.value).includes("0.735"))).toBe(true);
  const geometry=await toolbar.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,viewport:{width:innerWidth,height:innerHeight},scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}});
  fs.mkdirSync(artifacts,{recursive:true});
  fs.writeFileSync(path.join(artifacts,`final-${info.project.name}-fib.json`),JSON.stringify({geometry,layout:await layout(page),errors:state.errors},null,2));
  await page.screenshot({path:path.join(artifacts,`final-${info.project.name}-fib.png`),animations:"disabled"});
  expect(state.errors).toEqual([]);
});

test("Fib preset and default reset replace unfinished drafts, including equal applied values",async ({page})=>{
  const state=await fixture(page); const toolbar=await openFib(page);
  const ratio=toolbar.getByRole("spinbutton",{name:"Fib ratio",exact:true}).nth(3);
  await toolbar.getByRole("textbox",{name:"Fib preset name",exact:true}).fill("Audit levels");
  await toolbar.getByTitle("Save fib preset",{exact:true}).click();
  await expect.poll(()=>state.writes.some(w=>w.key==="fib-presets.v1")).toBe(true);
  await ratio.fill(""); await expect(ratio).toHaveValue("");
  await toolbar.getByRole("button",{name:"Fib presets",exact:true}).click();
  await page.getByRole("menu",{name:"Fib presets",exact:true}).getByRole("menuitemradio",{name:"Apply Audit levels",exact:true}).click();
  await expect(ratio).toHaveValue("0.5");
  await ratio.fill(""); await toolbar.getByTitle("Reset default levels",{exact:true}).click();
  await expect(ratio).toHaveValue("0.5");
  await ratio.fill("0.7"); await expect(ratio).toHaveValue("0.618");
  await toolbar.getByTitle("Reset default levels",{exact:true}).click();
  await expect(ratio).toHaveValue("0.5");
  await expect.poll(async()=> (await layout(page)).drawings.find((d:any)=>d.id==="audit-fib").fibLevels?.find((l:any)=>l.id==="05")?.value).toBe(0.5);
  expect(state.errors).toEqual([]);
});

test("Drawing row keyboard selects only the row; nested layer actions retain selection",async ({page})=>{
  const state=await fixture(page);
  const fib=page.locator(".drawing-object-row").filter({hasText:"Audit Fib"});
  const line=page.locator(".drawing-object-row").filter({hasText:"Audit Line"});
  await fib.focus(); await fib.press("Enter"); await expect(fib).toHaveClass(/chart-object-row-selected/);
  await line.focus(); await line.press("Space"); await expect(line).toHaveClass(/chart-object-row-selected/);
  await fib.getByRole("button",{name:"Settings for drawing Audit Fib",exact:true}).click();
  const popup=page.getByRole("dialog",{name:"Drawing settings for Audit Fib",exact:true});
  const action=popup.getByRole("button",{name:"Bring to front: Audit Fib",exact:true});
  await action.focus(); await action.press("Space");
  await expect(line).toHaveClass(/chart-object-row-selected/);
  await expect(fib).not.toHaveClass(/chart-object-row-selected/);
  await expect.poll(async()=> (await layout(page)).drawings.at(-1).id).toBe("audit-fib");
  const back=popup.getByRole("button",{name:"Send to back: Audit Fib",exact:true});
  await back.focus(); await back.press("Enter");
  await expect(line).toHaveClass(/chart-object-row-selected/);
  await expect.poll(async()=> (await layout(page)).drawings[0].id).toBe("audit-fib");
  await expect.poll(()=>state.writes.some(w=>w.key==="chart-layout.v1"&&w.value.drawings[0].id==="audit-fib")).toBe(true);
  expect(state.errors).toEqual([]);
});
