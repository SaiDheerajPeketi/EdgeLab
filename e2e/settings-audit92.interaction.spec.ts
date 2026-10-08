import {test as base,expect} from "@playwright/test";
import {build} from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
declare global{interface Window{settingsAuditFixture:any}}
const root=path.resolve(import.meta.dirname,".."),baseline=process.env.EDGELAB_SETTINGS_AUDIT92_BASELINE==="1";
type Harness={origin:string};
const test=base.extend<{harness:Harness},{serverHarness:Harness}>({
 serverHarness:[async({},use)=>{
  const mocks={"react-router-dom":'export function useLocation(){return {pathname:"/app/settings/data-providers",hash:""}}',SettingsDataTransfer:'export const SettingsDataTransfer=()=>null',SettingsIntegrations:'export const SettingsIntegrations=()=>null'};
  const built=await build({entryPoints:[path.join(root,"e2e/settings-audit92.fixture.tsx")],bundle:true,write:false,format:"iife",jsx:"automatic",define:{"import.meta.env":"{}"},plugins:[{name:"unrelated-panels",setup(b){
   b.onResolve({filter:/.*/},a=>{const name=a.path.split("/").at(-1);if(mocks[name])return{path:name,namespace:"audit92"}});
   b.onLoad({filter:/.*/,namespace:"audit92"},a=>({contents:mocks[a.path],loader:"js"}));
   if(baseline)b.onLoad({filter:/(SettingsCenter|SettingsSearch).tsx$/},a=>({contents:fs.readFileSync(path.join(root,".artifacts/settings-audit92-baseline",path.basename(a.path)),"utf8"),loader:"tsx",resolveDir:path.dirname(a.path)}));
  }}]});
  const assets=path.join(root,"frontend/dist/assets"),css=fs.readdirSync(assets).filter(n=>n.endsWith(".css")).map(n=>fs.readFileSync(path.join(assets,n))).join("\n");
  const server=http.createServer((req,res)=>{
   res.setHeader("Cache-Control","no-store");
   if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");res.end(built.outputFiles[0].contents)}
   else if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css)}
   else{res.setHeader("Content-Type","text/html");res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>')}
  });
  await new Promise<void>(resolve=>server.listen(45193,"127.0.0.1",resolve));try{await use({origin:"http://127.0.0.1:45193"})}finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
 },{scope:"worker"}],
 harness:async({serverHarness},use)=>use(serverHarness)
});
async function open(page,harness){
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const item=(key,value)=>({namespace:"edgelab",key,value,updated_at:"2026-10-08T10:00:00Z"});
 await page.route("**/api/**",async route=>{
  const url=new URL(route.request().url()),key=url.pathname.split("/").at(-1);
  if(url.pathname==="/api/settings/chart"){await route.fulfill({json:{active:item("active-chart-settings-preset.v1",null),presets:item("chart-settings-presets.v1",[])}});return}
  const value=key==="live-journal.v1"?{schemaVersion:1,settings:{default_broker:"Manual",default_currency:"USD",default_entry_type:"TAKEN",require_account_for_taken_trades:true},trades:[]}:key==="notebook-template.v1"?"Seed note":key==="settings-center.v1"?{density:"comfortable",includeDiagnosticsByDefault:true}:null;
  await route.fulfill({json:item(key,value)});
 });
 await page.goto(harness.origin);await expect(page.getByLabel("Currency",{exact:true})).toHaveValue("USD");return errors;
}
const rootInput=page=>page.locator("#setting-dataset-root input");
const search=page=>page.getByRole("combobox",{name:"Search settings",exact:true});
test("baseline search popup overflows a short viewport and keyboard active results remain outside its scroll window",async({page,harness},info)=>{
 test.skip(!baseline);await open(page,harness);await page.setViewportSize({width:390,height:320});await search(page).fill("a");
 const list=page.getByRole("listbox");await expect(list.getByRole("option")).toHaveCount(8);
 for(let i=0;i<7;i++)await search(page).press("ArrowDown");
 const measured=await list.evaluate(el=>{const r=el.getBoundingClientRect(),active=el.querySelector('[aria-selected="true"]'),a=active.getBoundingClientRect();return{list:{top:r.top,bottom:r.bottom,height:r.height,scrollTop:el.scrollTop},active:{top:a.top,bottom:a.bottom},viewport:{width:innerWidth,height:innerHeight}}});
 expect(measured.list.bottom).toBeGreaterThan(measured.viewport.height);expect(measured.active.bottom).toBeGreaterThan(measured.list.bottom);expect(measured.list.scrollTop).toBe(0);
 await expect(page.getByLabel("Filter settings search by category")).toHaveJSProperty("tagName","SELECT");
 fs.mkdirSync(path.join(root,".artifacts"),{recursive:true});fs.writeFileSync(path.join(root,".artifacts/settings-audit92-search-baseline-"+info.project.name+".json"),JSON.stringify(measured,null,2));
 await page.screenshot({path:path.join(root,".artifacts/settings-audit92-search-baseline-"+info.project.name+".png"),animations:"disabled"});
});
test("baseline dataset drafts leak across an auth owner switch and reset clears the root instead of restoring it",async({page,harness},info)=>{
 test.skip(!baseline);await open(page,harness);
 await rootInput(page).fill("/private-owner-a/draft");await page.getByLabel("Currency",{exact:true}).fill("EUR");
 await page.evaluate(()=>window.settingsAuditFixture.switchOwner(9202));
 await expect(rootInput(page)).toHaveValue("/private-owner-a/draft");await expect(page.getByLabel("Currency",{exact:true})).toHaveValue("EUR");
 const receipt={owner:await page.evaluate(()=>window.settingsAuditFixture.current.owner),root:await rootInput(page).inputValue(),currency:await page.getByLabel("Currency",{exact:true}).inputValue()};
 await page.getByRole("button",{name:/^Reset section/}).click();await expect(rootInput(page)).toHaveValue("");await expect(page.getByText("Enter a dataset folder path.",{exact:true})).toBeVisible();
 fs.writeFileSync(path.join(root,".artifacts/settings-audit92-owner-reset-baseline-"+info.project.name+".json"),JSON.stringify(receipt,null,2));
});

const modernOnly=()=>test.skip(baseline);
const writes=page=>page.evaluate(()=>({root:window.settingsAuditFixture.rootWrites,asset:window.settingsAuditFixture.assetWrites}));
async function select(page,name,label){
 const control=page.getByRole("combobox",{name,exact:true}),id=await control.getAttribute("aria-controls");await control.click();
 await page.locator('[id="'+id+'"]').getByRole("option",{name:label,exact:true}).click();
}
async function geometry(list){return list.evaluate(el=>{
 const r=el.getBoundingClientRect(),a=el.querySelector('[aria-selected="true"]').getBoundingClientRect();
 return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,activeTop:a.top,activeBottom:a.bottom,scrollTop:el.scrollTop,width:innerWidth,height:innerHeight};
})}
async function nativeSearchAppearance(page){
 const session=await page.context().newCDPSession(page);
 try{
  await session.send("DOM.enable");await session.send("CSS.enable");
  const {root}=await session.send("DOM.getDocument",{depth:-1,pierce:true});
  const {nodeId}=await session.send("DOM.querySelector",{nodeId:root.nodeId,selector:".settings-search-input"});
  const {node}=await session.send("DOM.describeNode",{nodeId,depth:-1,pierce:true});
  const find=n=>n.attributes?.some((value,i)=>value==="pseudo"&&n.attributes[i+1]==="-webkit-search-cancel-button")?n:[...n.children??[],...n.shadowRoots??[],...n.pseudoElements??[]].map(find).find(Boolean);
  const cancel=find(node);if(!cancel)throw new Error("Native Chromium search-cancel node was unavailable.");
  const {computedStyle}=await session.send("CSS.getComputedStyleForNode",{nodeId:cancel.nodeId});
  return computedStyle.find(property=>property.name==="appearance")?.value;
 }finally{await session.detach()}
}
test("search popup stays within a short viewport and keeps keyboard-selected options visible through resize",async({page,harness},info)=>{
 modernOnly();const errors=await open(page,harness),original=page.viewportSize();await page.setViewportSize({width:390,height:320});
 await search(page).fill("a");
 // Chromium exposes its native cancel control through the UA shadow tree;
 // getComputedStyle(host, pseudo) incorrectly reports the host textfield style.
 expect(await nativeSearchAppearance(page)).toBe("none");
 await expect(page.getByRole("button",{name:"Clear settings search",exact:true})).toHaveCount(1);
 const list=page.getByRole("listbox",{name:"Settings search results"});await expect(list.getByRole("option")).toHaveCount(8);
 for(let i=0;i<7;i++)await search(page).press("ArrowDown");
 await expect.poll(async()=>{const g=await geometry(list);return g.top>=7&&g.bottom<=g.height-7&&g.activeTop>=g.top-1&&g.activeBottom<=g.bottom+1&&g.scrollTop>0}).toBe(true);
 await search(page).press("ArrowDown");await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected","true");
 await expect.poll(async()=>{const g=await geometry(list);return g.activeTop>=g.top-1&&g.activeBottom<=g.bottom+1}).toBe(true);
 await search(page).press("ArrowUp");await expect(list.getByRole("option").last()).toHaveAttribute("aria-selected","true");
 await page.setViewportSize(original);
 await expect.poll(async()=>{const g=await geometry(list);return g.top>=7&&g.bottom<=g.height-7&&g.left>=7&&g.right<=g.width-7}).toBe(true);
 await expect.poll(()=>list.evaluate(el=>getComputedStyle(el).opacity)).toBe("1");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:path.join(root,".artifacts/settings-audit92-search-final-"+info.project.name+".png"),animations:"disabled"});
 await search(page).press("Escape");await expect(list).toHaveCount(0);await expect(search(page)).toBeFocused();expect(errors).toEqual([]);
});
test("search filter uses the real themed popup and clear returns focus while mouse and keyboard results navigate",async({page,harness},info)=>{
 modernOnly();const errors=await open(page,harness);await search(page).fill("risk");
 const filter=page.getByRole("combobox",{name:"Filter settings search by category",exact:true}),menuId=await filter.getAttribute("aria-controls");
 await filter.click();const menu=page.locator('[id="'+menuId+'"]');await expect(menu).toBeVisible();await expect(page.getByRole("listbox",{name:"Settings search results"})).toHaveCount(0);
 const themed=await menu.evaluate(el=>{const c=getComputedStyle(el);return{bg:c.backgroundColor,text:c.color,tokenBg:c.getPropertyValue("--ui-floating").trim(),tokenText:c.getPropertyValue("--text-primary").trim()}});
 const resolve=await menu.evaluate((el,colors)=>{const probe=document.createElement("div");el.append(probe);const values=colors.map(color=>{probe.style.color=color;return getComputedStyle(probe).color});probe.remove();return values},[themed.tokenBg,themed.tokenText]);
 expect(themed.bg).toBe(resolve[0]);expect(themed.text).toBe(resolve[1]);
 await expect.poll(()=>menu.evaluate(el=>getComputedStyle(el).opacity)).toBe("1");
 expect(await menu.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=7&&r.bottom<=innerHeight-7&&r.left>=7&&r.right<=innerWidth-7})).toBe(true);
 await page.screenshot({path:path.join(root,".artifacts/settings-audit92-filter-final-"+info.project.name+".png"),animations:"disabled"});
 await menu.getByRole("option",{name:"Backtest",exact:true}).click();await expect(filter).toHaveText("Backtest");
 await search(page).focus();await expect(page.getByRole("listbox",{name:"Settings search results"})).toBeVisible();
 await page.getByRole("button",{name:"Clear settings search",exact:true}).click();await expect(search(page)).toBeFocused();await expect(search(page)).toHaveValue("");
 await search(page).fill("quantity");await search(page).press("Enter");await expect(page.getByRole("heading",{name:"Backtest",exact:true})).toBeVisible();
 await expect(page.locator("#setting-default-quantity")).toBeFocused();await expect(search(page)).toHaveValue("");
 await select(page,"Filter settings search by category","All categories");await search(page).fill("instrument");
 await page.getByRole("option",{name:/Instrument calibration/}).click();await expect(page.getByRole("heading",{name:"Data & providers",exact:true})).toBeVisible();
 await expect(page.locator("#setting-asset-calibration")).toBeFocused();expect(errors).toEqual([]);
});
test("dataset reset restores every confirmed instrument and root without dispatching writes",async({page,harness},info)=>{
 modernOnly();await open(page,harness);await rootInput(page).fill("/staged/path");await page.getByLabel("Currency",{exact:true}).fill("EUR");
 await select(page,"Instrument","Beta · BETA");await page.getByLabel("Currency",{exact:true}).fill("CAD");await page.getByLabel("P&L multiplier",{exact:true}).fill("4");
 await page.getByRole("button",{name:/^Reset section/}).click();await expect(rootInput(page)).toHaveValue("/owner-a/data");
 await expect(page.getByLabel("Currency",{exact:true})).toHaveValue("GBP");await expect(page.getByLabel("P&L multiplier",{exact:true})).toHaveValue("2");
 await select(page,"Instrument","Alpha · ALPHA");await expect(page.getByLabel("Currency",{exact:true})).toHaveValue("USD");
 await expect(page.getByRole("button",{name:"Apply dataset root",exact:true})).toBeDisabled();await expect(page.getByRole("button",{name:"Save instrument",exact:true})).toBeDisabled();
 await expect(page.getByText("Enter a dataset folder path.",{exact:true})).toHaveCount(0);expect(await writes(page)).toEqual({root:[],asset:[]});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:path.join(root,".artifacts/settings-audit92-reset-final-"+info.project.name+".png"),fullPage:true,animations:"disabled"});
});
test("auth identity replacement removes the previous owner's local dataset drafts and receipts",async({page,harness})=>{
 modernOnly();await open(page,harness);await rootInput(page).fill("/private-owner-a/draft");await page.getByLabel("Currency",{exact:true}).fill("EUR");
 await page.evaluate(()=>window.settingsAuditFixture.switchOwner(9202));await expect(rootInput(page)).toHaveValue("/owner-b/data");await expect(page.getByLabel("Currency",{exact:true})).toHaveValue("JPY");
 await expect(page.getByLabel("P&L multiplier",{exact:true})).toHaveValue("3");await expect(page.getByText("Draft changes not applied",{exact:true})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Apply dataset root",exact:true})).toBeDisabled();expect(await writes(page)).toEqual({root:[],asset:[]});
});
test("held prior-owner save completion cannot alter the new owner's later draft or status",async({page,harness})=>{
 modernOnly();const errors=await open(page,harness);await page.evaluate(()=>window.settingsAuditFixture.holdRoot());
 await rootInput(page).fill("/owner-a/submitted");await page.getByRole("button",{name:"Apply dataset root",exact:true}).click();
 await expect(page.locator("#setting-dataset-root").getByRole("status")).toHaveText("Saving…");
 await page.evaluate(()=>window.settingsAuditFixture.switchOwner(9202));await expect(rootInput(page)).toHaveValue("/owner-b/data");
 await rootInput(page).fill("/owner-b/later");await page.evaluate(()=>window.settingsAuditFixture.releaseRoot());
 await expect(rootInput(page)).toHaveValue("/owner-b/later");await expect(page.locator("#setting-dataset-root").getByRole("status")).toHaveCount(0);
 await page.getByRole("button",{name:"Apply dataset root",exact:true}).click();await expect(page.locator("#setting-dataset-root").getByRole("status")).toHaveText("Saved");
 expect((await writes(page)).root).toEqual([{owner:9201,payload:{root_path:"/owner-a/submitted"}},{owner:9202,payload:{root_path:"/owner-b/later"}}]);expect(errors).toEqual([]);
});
test("reset during an admitted save remains a later unapplied edit after acknowledgment",async({page,harness})=>{
 modernOnly();await open(page,harness);await page.evaluate(()=>window.settingsAuditFixture.holdRoot());
 await rootInput(page).fill("/submitted/path");await page.getByRole("button",{name:"Apply dataset root",exact:true}).click();
 await page.getByRole("button",{name:/^Reset section/}).click();await expect(rootInput(page)).toHaveValue("/owner-a/data");
 await expect(page.locator("#setting-dataset-root").getByRole("status")).toHaveText("Saving…");await page.evaluate(()=>window.settingsAuditFixture.releaseRoot());
 await expect(page.getByRole("button",{name:"Apply dataset root",exact:true})).toBeEnabled();await expect(rootInput(page)).toHaveValue("/owner-a/data");
 await expect(page.locator("#setting-dataset-root").getByRole("status")).toHaveCount(0);await expect(page.getByText("Draft changes not applied",{exact:true})).toBeVisible();
 expect((await writes(page)).root).toEqual([{owner:9201,payload:{root_path:"/submitted/path"}}]);
});
