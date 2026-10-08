import { test as base, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.EDGELAB_THEME110_PORT ?? 45310);
type Harness = { origin: string };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const bundle = await build({ entryPoints: [path.join(root, "e2e/theme-controls110.fixture.tsx")], bundle: true,
      write: false, format: "iife", jsx: "automatic", define: { "import.meta.env": "{}" } });
    const assets = path.join(root, "frontend/dist/assets");
    const css = fs.readdirSync(assets).filter(name => name.endsWith(".css")).map(name => fs.readFileSync(path.join(assets, name))).join("\n");
    const server = http.createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
      else if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
      else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body style="background:var(--ui-canvas);margin:0"><div id="root"></div><script src="/fixture.js"></script>'); }
    });
    await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:" + port }); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }, { scope: "worker" }],
  harness: async ({ serverHarness }, use) => use(serverHarness),
});
const tokens = { "--ui-floating":"#292034", "--ui-inset":"#172229", "--ui-hover":"#334455", "--ui-selection":"#654567", "--text-primary":"#EEDDBB", "--text-secondary":"#C2AB9A", "--ui-border-strong":"#997755", "--ui-focus":"#F5AA66", "--danger-action":"#AE2457", "--danger-action-hover":"#842349", "--on-danger-action":"#FFF5EE" };
Object.assign(tokens,{"--interaction":"#CC9855","--interaction-hover":"#DDAA66","--interaction-pressed":"#AA7733","--on-interaction":"#071018","--information":"#C4ACF0","--information-soft":"#302942","--text-muted":"#93827A"});
const tableNames=["dataset_settings","dataset_assets","dataset_timeframes","app_storage","playbooks","backtest_sessions","positions","orders","trades","executions","trade_notes","journal_accounts","journal_import_runs","canonical_trades","canonical_executions","journal_tags","canonical_trade_tags","canonical_trade_notes","canonical_trade_screenshots","journal_daily_notes","journal_import_rows","journal_import_diagnostics","journal_backfill_checkpoints"];
async function sentinel(page: Page) { await page.evaluate(values=>{for(const [key,value]of Object.entries(values))document.body.style.setProperty(key,value)},tokens); }
async function paint(locator: any) { return locator.evaluate((node: Element)=>{const style=getComputedStyle(node);return {background:style.backgroundColor,color:style.color,border:style.borderColor,outline:style.outlineColor,shadow:style.boxShadow}}); }
const bundle={app:"edgelab",version:1,tables:{app_storage:[{id:7,value:{theme:"retained"}}]}};
async function open(page: Page,harness: Harness) {
  const state={writes:[] as any[],paid:false,failConnection:false,connections:[{id:1,provider:"ninjatrader",display_name:"Alpha",status:"connected",health:"healthy",last_sync_completed_at:null,revoked_at:null}],secrets:[{id:1,provider:"ninjatrader",purpose:"broker-sync",version:1,key_id:"vault-existing110",state:"active",last_connected_at:null}],errors:[]as string[]};
  page.on("pageerror",error=>state.errors.push(error.message));
  const operations=new Map<string,any>();
  await page.route("**/api/**",async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():null,id=req.headers()["x-edgelab-operation-id"];
    const finish=async(status:number,json:any)=>{if(id&&operations.has(id))operations.set(id,{...operations.get(id),status:"completed",http_status:status,completed_at:new Date().toISOString()});await route.fulfill({status,json})};
    if(url.pathname.endsWith("/reserve")) {const receipt={operation_id:url.pathname.split("/").at(-2),method:body.method,path:body.path,status:"reserved",http_status:null,result:null,created_at:new Date().toISOString(),completed_at:null};operations.set(receipt.operation_id!,receipt);return route.fulfill({json:receipt})}
    if(url.pathname.endsWith("/recover"))return route.fulfill({json:operations.get(url.pathname.split("/").at(-2)!)});
    if(url.pathname==="/api/billing/status")return finish(200,{provider:"stripe",mode:"live",configured:true,workspace_access:state.paid,subscription_access:state.paid,plan:state.paid?"pro":null,status:state.paid?"active":"inactive",cadence:state.paid?"monthly":null,current_period_end:state.paid?"2099-01-01T00:00:00Z":null,cancel_at_period_end:false,verified_at:new Date().toISOString(),refresh_required:false});
    if(url.pathname==="/api/broker-providers")return finish(200,[{provider_id:"ninjatrader",display_name:"NinjaTrader",description:"Authenticated broker adapter.",availability:"available",requires_secret:true,capabilities:{accounts:true,orders:false,fills:true,incremental_sync:true,live_connectivity:true}},{provider_id:"offline-fixture",display_name:"Offline fixture",description:"Local adapter.",availability:"offline-fixture",requires_secret:true,capabilities:{accounts:true,orders:false,fills:true,incremental_sync:false,live_connectivity:false}}]);
    if(url.pathname==="/api/integration-secrets"&&req.method()==="GET")return finish(200,state.secrets);
    if(url.pathname==="/api/broker-connections"&&req.method()==="GET")return finish(200,state.connections);
    if(req.method()!=="GET" || url.pathname==="/api/app-data/export")state.writes.push({path:url.pathname,body});
    if(url.pathname==="/api/app-data/export")return finish(200,{app:"edgelab",version:1,exported_at:new Date().toISOString(),tables:Object.fromEntries(tableNames.map(name=>[name,[]]))});
    if(url.pathname==="/api/app-data/import"){const result={ok:true,imported_at:new Date().toISOString(),summary:Object.fromEntries(tableNames.map(name=>[name,body.tables[name]?.length??0]))};if(id&&operations.has(id))operations.get(id).result=result;return finish(200,result)}
    if(url.pathname==="/api/integration-secrets"){const secret={id:2,provider:body.provider,purpose:body.purpose,version:1,key_id:"vault-created110",state:"active",last_connected_at:null};state.secrets.push(secret);return finish(200,secret)}
    if(url.pathname.endsWith("/connect"))return finish(200,{ok:true});
    if(url.pathname==="/api/broker-connections"){if(state.failConnection)return finish(503,{detail:"Broker handshake unavailable"});const connection={...state.connections[0],id:2,provider:body.provider,display_name:body.display_name};state.connections.push(connection);return finish(200,connection)}
    if(url.pathname==="/api/broker-connections/1"&&req.method()==="DELETE"){state.connections[0].revoked_at=new Date().toISOString();return finish(200,state.connections[0])}
    return finish(404,{detail:"Unexpected boundary request"});
  });
  await page.goto(harness.origin);await expect(page.getByRole("button",{name:"Audit date",exact:true})).toBeVisible();return state;
}
async function section(page:Page,name:string){await page.getByRole("navigation",{name:"Fixture sections"}).getByRole("button",{name,exact:true}).click()}
async function token(page:Page,name:string,property="color"){return page.evaluate(({name,property})=>{const node=document.createElement("span");node.style.setProperty(property,"var("+name+")");document.body.append(node);const value=getComputedStyle(node).getPropertyValue(property);node.remove();return value},{name,property})}
async function matches(page:Page,locator:any,property:string,name:string){await expect.poll(()=>locator.evaluate((node:Element,property:string)=>getComputedStyle(node).getPropertyValue(property),property)).toBe(await token(page,name,property))}
async function contained(locator:any){const r=await locator.evaluate((node:Element)=>{const b=node.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:innerWidth,height:innerHeight}});expect(r.left).toBeGreaterThanOrEqual(0);expect(r.top).toBeGreaterThanOrEqual(0);expect(r.right).toBeLessThanOrEqual(r.width+1);expect(r.bottom).toBeLessThanOrEqual(r.height+1);return r}
async function capture(page:Page,info:any,view:string,receipt:any){if(process.env.EDGELAB_THEME110_CAPTURE==="0")return;const dir=path.join(root,".artifacts/theme-controls110");fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,"final-"+view+"-"+info.project.name+".png"),animations:"disabled",fullPage:view!=="date"});fs.writeFileSync(path.join(dir,"final-"+view+"-"+info.project.name+".json"),JSON.stringify(receipt,null,2))}
async function chooseBundle(page:Page){const chooser=page.waitForEvent("filechooser");await page.getByRole("button",{name:/^Choose (?:JSON bundle|a different file)$/}).click();await(await chooser).setFiles({name:"theme110.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(bundle))});await expect(page.getByText("Validated bundle v1",{exact:false})).toBeVisible()}
test("calendar retains keyboard date and year behavior while inherited theme changes update the open portal",async({page,harness},info)=>{
  const state=await open(page,harness);const trigger=page.getByRole("button",{name:"Audit date",exact:true});await trigger.click();const calendar=page.getByRole("dialog");const day=calendar.getByRole("gridcell",{name:/October 8, 2026/});
  await expect(day).toBeFocused();await matches(page,calendar,"background-color","--ui-floating");await sentinel(page);await matches(page,calendar,"background-color","--ui-floating");await matches(page,calendar,"color","--text-primary");
  await matches(page,day,"background-color","--ui-selection");await matches(page,day,"border-top-color","--ui-focus");
  await day.press("ArrowRight");const next=calendar.getByRole("gridcell",{name:/October 9, 2026/});await expect(next).toBeFocused();expect((await paint(next)).shadow).toContain(await token(page,"--ui-focus"));
  const inactive=calendar.getByRole("gridcell",{name:/October 10, 2026/});await inactive.hover();await matches(page,inactive,"background-color","--ui-hover");
  await next.press("Enter");await expect(page.getByTestId("date-owner")).toHaveText("2026-10-09");await expect(calendar).toBeHidden();
  await trigger.click();await calendar.getByRole("button",{name:"Choose a year",exact:true}).click();const year=calendar.getByRole("gridcell",{name:"Choose 2026",exact:true});await expect(year).toBeFocused();await matches(page,year,"background-color","--ui-selection");await year.press("ArrowRight");await expect(calendar.getByRole("gridcell",{name:"Choose 2027",exact:true})).toBeFocused();await page.keyboard.press("Enter");await calendar.getByRole("gridcell",{name:/October 9, 2027/}).press("Enter");await expect(page.getByTestId("date-owner")).toHaveText("2027-10-09");
  await trigger.click();const receipt={geometry:await contained(calendar),paint:await paint(calendar)};await capture(page,info,"date",receipt);await page.keyboard.press("Escape");await expect(calendar).toBeHidden();
  await trigger.click();await calendar.getByRole("button",{name:"Clear",exact:true}).click();await expect(page.getByTestId("date-owner")).toHaveText("");await matches(page,trigger.locator("span"),"color","--text-muted");expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test("real twelve and twenty-four hour time controls keep staged Set and Cancel contracts under token changes",async({page,harness})=>{
  const state=await open(page,harness);const trigger=page.getByRole("button",{name:/2026-10-08.*01:25 PM/});await trigger.click();const menu=page.getByRole("dialog",{name:"Audit date and time",exact:true});await sentinel(page);await matches(page,menu,"background-color","--ui-floating");
  const hour=menu.getByRole("spinbutton",{name:"HH",exact:true}),minute=menu.getByRole("spinbutton",{name:"MM",exact:true});await hour.fill("12");await minute.fill("59");await menu.getByRole("button",{name:"PM",exact:true}).click();await matches(page,menu.getByRole("button",{name:"PM",exact:true}),"background-color","--ui-hover");await page.mouse.move(0,0);await matches(page,menu.getByRole("button",{name:"PM",exact:true}),"background-color","--ui-selection");
  await matches(page,hour,"color","--text-primary");await contained(menu);await menu.getByRole("button",{name:"Set",exact:true}).click();await expect(page.getByTestId("time-owner")).toHaveText("2026-10-08T12:59");
  await page.getByRole("button",{name:"Use 24 hour time",exact:true}).click();await page.getByRole("button",{name:/2026-10-08.*12:59/}).click();await hour.fill("23");await minute.fill("120");await expect(minute).toHaveValue("59");await menu.getByRole("button",{name:"Cancel",exact:true}).click();await expect(page.getByTestId("time-owner")).toHaveText("2026-10-08T12:59");
  await page.getByRole("button",{name:/2026-10-08.*12:59/}).click();await hour.fill("23");await minute.fill("58");await menu.getByRole("button",{name:"Set",exact:true}).click();await expect(page.getByTestId("time-owner")).toHaveText("2026-10-08T23:58");expect(state.errors).toEqual([]);
});
test("actual primitive checked selected focus hover and information states consume explicit semantic tokens",async({page,harness})=>{
  const state=await open(page,harness);await sentinel(page);
  const toggle=page.getByRole("switch",{name:"Audit toggle",exact:true});await matches(page,toggle.locator("span").first(),"background-color","--ui-selection");await matches(page,toggle.locator("span").last(),"background-color","--text-primary");
  const checkbox=page.getByRole("checkbox",{name:"Audit checkbox",exact:true});await matches(page,checkbox.locator("xpath=following-sibling::span[1]"),"background-color","--interaction");await checkbox.focus(); await checkbox.press("Space");await expect(toggle).toHaveAttribute("aria-checked","false");await toggle.click();await expect(checkbox).toBeChecked();
  const radio=page.getByRole("radio",{name:"Second radio",exact:true});await matches(page,radio,"accent-color","--interaction");await radio.check();await expect(radio).toBeChecked();
  const slider=page.getByRole("slider",{name:"Audit amount",exact:true});await matches(page,slider,"accent-color","--interaction");await slider.focus();await slider.press("End");await expect(slider).toHaveValue("10");
  await matches(page,page.getByRole("group",{name:"Audit segment",exact:true}).getByRole("button",{name:"Second segment",exact:true}),"color","--text-primary");
  const action=page.getByRole("button",{name:"Audit primary action",exact:true});await action.hover();await matches(page,action,"background-color","--interaction-hover");await action.focus();await action.press("Tab");await page.keyboard.press("Shift+Tab");expect((await paint(action)).shadow).toContain(await token(page,"--ui-focus"));
  const banner=page.getByRole("status").filter({has:page.getByRole("heading",{name:"Audit information",exact:true})});await matches(page,banner,"background-color","--information-soft");await matches(page,banner,"color","--information");
  const combo=page.getByRole("combobox",{name:"Audit combobox",exact:true});await combo.click();const list=page.getByRole("listbox");await matches(page,list,"background-color","--ui-floating");const selected=list.getByRole("option",{name:"Second option",exact:true});await matches(page,selected.locator("svg"),"color","--interaction");await combo.press("Escape");await expect(list).toBeHidden();expect(state.errors).toEqual([]);
});
test("portable data keeps the paid export gate and preview confirmation while danger paints follow inherited tokens",async({page,harness},info)=>{
  const state=await open(page,harness);await section(page,"transfer");const download=page.getByRole("button",{name:"Download export",exact:true});await expect(download).toBeDisabled();expect(state.writes).toEqual([]);
  state.paid=true;await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));await expect(download).toBeEnabled();const completed=page.waitForEvent("download");await download.click();await(await completed).delete();expect(state.writes.filter(w=>w.path==="/api/app-data/export")).toHaveLength(1);
  await chooseBundle(page);const replace=page.getByRole("button",{name:"Replace data",exact:true});await expect(replace).toBeDisabled();await page.getByLabel("Type IMPORT to confirm",{exact:true}).fill("import");await expect(replace).toBeEnabled();await sentinel(page);await matches(page,replace,"background-color","--danger-action");await matches(page,replace,"color","--on-danger-action");await replace.hover();await matches(page,replace,"background-color","--danger-action-hover");await page.getByRole("heading",{name:"Portable data",exact:true}).hover();
  const receipt={paint:await paint(replace),writesBeforeImport:state.writes.length};await capture(page,info,"transfer",receipt);expect(state.writes.filter(w=>w.path==="/api/app-data/import")).toHaveLength(0);
  await replace.click();await expect(page.getByText("Import complete",{exact:true})).toBeVisible();expect(state.writes.filter(w=>w.path==="/api/app-data/import")).toEqual([{path:"/api/app-data/import",body:bundle}]);await expect(download).toBeDisabled();await expect(page.getByRole("button",{name:"Reload workspace",exact:true})).toBeVisible();expect(state.errors).toEqual([]);
});
test("provider popup and explicit revocation follow body tokens without changing keyboard selection or confirmation writes",async({page,harness},info)=>{
  const state=await open(page,harness);await section(page,"integrations");const alpha=page.getByRole("group",{name:"Alpha connection",exact:true});await expect(alpha).toBeVisible();await alpha.getByRole("button",{name:"Revoke",exact:true}).click();const confirm=alpha.getByRole("button",{name:"Confirm revoke",exact:true});await sentinel(page);await matches(page,confirm,"background-color","--danger-action");await matches(page,confirm,"color","--on-danger-action");await confirm.hover();await matches(page,confirm,"background-color","--danger-action-hover");await alpha.getByRole("button",{name:"Cancel",exact:true}).click();expect(state.writes).toEqual([]);
  const provider=page.getByRole("combobox",{name:"Provider",exact:true});await provider.click();const menu=page.getByRole("listbox");await matches(page,menu,"background-color","--ui-floating");await matches(page,menu,"color","--text-primary");await contained(menu); await page.evaluate(()=>document.body.style.setProperty("--ui-floating", "#224466")); await matches(page,menu,"background-color","--ui-floating");
  await capture(page,info,"integrations",{geometry:await contained(menu),paint:await paint(menu)});await provider.press("ArrowDown");await provider.press("Enter");await expect(provider).toContainText("Offline fixture");await expect(page.getByLabel("Connection name",{exact:true})).toHaveValue("Offline fixture");await expect(page.getByLabel("Fixture token",{exact:true})).toBeVisible();
  await alpha.getByRole("button",{name:"Revoke",exact:true}).click();await confirm.click();await expect(alpha).toContainText("Revoked");expect(state.writes).toEqual([{path:"/api/broker-connections/1",body:null}]);expect(state.errors).toEqual([]);
});
test("connection failure keeps confirmed vault metadata and retry reuses the same saved credential",async({page,harness})=>{
  const state=await open(page,harness);await section(page,"integrations");await expect(page.getByRole("group",{name:"Alpha connection",exact:true})).toBeVisible();await page.getByLabel("API key",{exact:true}).fill("write-only110");state.failConnection=true;await page.getByRole("button",{name:"Save credential and create connection",exact:true}).click();await expect(page.getByRole("alert")).toContainText("Broker handshake unavailable");await expect(page.locator('[data-setting-control="credential-vault"]')).toContainText("vault-created110");await expect(page.getByLabel("API key",{exact:true})).toHaveValue("");
  await page.getByLabel("Connection name",{exact:true}).fill("Recovery connection");state.failConnection=false;await page.getByRole("button",{name:"Retry connection setup",exact:true}).click();await expect(page.getByRole("group",{name:"Recovery connection connection",exact:true})).toBeVisible();
  expect(state.writes.filter(w=>w.path==="/api/integration-secrets")).toHaveLength(1);expect(state.writes.filter(w=>w.path==="/api/broker-connections")).toEqual([{path:"/api/broker-connections",body:{provider:"ninjatrader",display_name:"NinjaTrader",secret_id:2}},{path:"/api/broker-connections",body:{provider:"ninjatrader",display_name:"Recovery connection",secret_id:2}}]);expect(state.errors).toEqual([]);
});
