import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
declare global { interface Window { settingsThemeFixture: any; } }
const root = path.resolve(import.meta.dirname, "..");
const seed = { schemaVersion: 1, settings: { default_broker: "Seed broker", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: true, unknown: "preserved" }, trades: [], unknown: { preserved: true } };
const seedNote = "Seed review\nEntry: {entry}";
const seedPreferences = { density: "comfortable", includeDiagnosticsByDefault: true };
type Harness = { origin: string };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const mocks = {
      "react-router-dom": 'export function useLocation(){return {pathname:"/app/settings/journal",hash:""}}',
      SettingsDataTransfer: 'export const SettingsDataTransfer=()=>null',
      SettingsIntegrations: 'export const SettingsIntegrations=()=>null',
      SettingsSearch: 'export const SettingsSearch=()=>null',
    };
    // Only unrelated panels are isolated. Hooks, controls, HTTP client, auth and cache stay genuine.
    const bundle = await build({ entryPoints: [path.join(root, "e2e/settings-theme88.fixture.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic", define: { "import.meta.env": "{}" },
      plugins: [{ name: "unrelated-settings-panels", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => { const name = args.path.split("/").at(-1); if (mocks[name]) return { path: name, namespace: "theme88" }; });
        builder.onLoad({ filter: /.*/, namespace: "theme88" }, args => ({ contents: mocks[args.path], loader: "js" }));
      } }] });
    const assets = path.join(root, "frontend/dist/assets"), css = fs.readdirSync(assets).filter(name => name.endsWith(".css")).map(name => fs.readFileSync(path.join(assets, name))).join("\n");
    fs.mkdirSync(path.join(root, ".artifacts"), { recursive: true });
    fs.writeFileSync(path.join(root, ".artifacts/settings-theme88-frozen.txt"), createHash("sha256").update(bundle.outputFiles[0].contents).digest("hex"));
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1"); res.setHeader("Cache-Control", "no-store");
      if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'); }
      else if (url.pathname === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
      else if (url.pathname === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].contents); }
      else { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>(resolve => server.listen(45189, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:45189" }); } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ serverHarness }, use) => { await use(serverHarness); }
});
async function open(page, harness) {
  const state = { journal: structuredClone(seed), note: seedNote, preferences: { ...seedPreferences }, writes: [], reads: [], operations: new Map(),
    storage: new Map(), holdChartRead: null };
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const item = (key, value) => ({ namespace: "edgelab", key, value, updated_at: "2026-10-08T10:00:00Z" });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), body = request.postData() ? request.postDataJSON() : null;
    const key = url.pathname.split("/").at(-1);
    const operationId = request.headers()["x-edgelab-operation-id"];
    const finish = async (status, json) => {
      if (operationId && state.operations.has(operationId)) state.operations.set(operationId, { ...state.operations.get(operationId), status: "completed", http_status: status, completed_at: "2026-10-08T10:00:01Z" });
      await route.fulfill({ status, json });
    };
    if (/^\/api\/app-data\/operations\/[^/]+\/reserve$/.test(url.pathname)) {
      const receipt = { operation_id: url.pathname.split("/").at(-2), method: body.method, path: body.path, status: "reserved", http_status: null, result: null, created_at: "2026-10-08T10:00:00Z", completed_at: null };
      state.operations.set(receipt.operation_id, receipt); await route.fulfill({ json: receipt }); return;
    }
    if (/^\/api\/app-data\/operations\/[^/]+\/recover$/.test(url.pathname)) { await route.fulfill({ json: state.operations.get(url.pathname.split("/").at(-2)) }); return; }
    if (method === "GET") {
      state.reads.push(url.pathname);
      if (url.pathname === "/api/settings/chart") { if(state.holdChartRead) await state.holdChartRead; await route.fulfill({json:{active:item("active-chart-settings-preset.v1",null),presets:item("chart-settings-presets.v1",[])}}); return; }
      const value = key === "live-journal.v1" ? state.journal : key === "notebook-template.v1" ? state.note : key === "settings-center.v1" ? state.preferences : state.storage.get(key) ?? null;
      await route.fulfill({ json: item(key, value) }); return;
    }
    state.writes.push({ path: url.pathname, method, body, authorization: request.headers().authorization });

    if(url.pathname === "/api/journal/settings") {
      state.journal={...state.journal,settings:{...state.journal.settings,...body}};
      await finish(200,item("live-journal.v1",state.journal));return;
    }
    if(url.pathname === "/api/settings/preferences") {
      state.preferences={...state.preferences,...body};
      await finish(200,item("settings-center.v1",state.preferences));return;
    }
    if(method === "PUT" && url.pathname.includes("/app-storage/")) {state.storage.set(key,body.value); await finish(200,item(key,body.value));return;}
    await route.fulfill({ status: 404, json: { detail: "Unexpected mutation" } });
  });
  await page.goto(harness.origin);
  await expect(page.getByLabel("Currency", { exact: true })).toHaveValue("USD");
  await expect.poll(() => page.evaluate(() => window.settingsThemeFixture.current?.preferences.ready)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.settingsThemeFixture.current.chart.ready && window.settingsThemeFixture.current.backtest.ready)).toBe(true);
  return { state, errors };
}
async function category(page, id, label) {
  if(page.viewportSize().width<1024) {
    const control=page.getByRole("combobox",{name:"Settings category",exact:true});
    if(await control.evaluate(el=>el.tagName==="SELECT")) await control.selectOption(id);
    else {await control.click();await page.getByRole("option",{name:label,exact:true}).click();}
  } else await page.getByRole("button",{name:new RegExp("^"+label.replaceAll("&","\\&"))}).click();
}
test("baseline genuine settings controls are native selects",async({page,harness},info)=>{
 test.skip(process.env.EDGELAB_SETTINGS_THEME88_BASELINE!=="1");
 await open(page,harness);
 await expect(page.getByRole("combobox",{name:/^Default entry type/})).toHaveJSProperty("tagName","SELECT");
 await category(page,"appearance","Appearance");
 await expect(page.getByLabel("Settings density",{exact:true})).toHaveJSProperty("tagName","SELECT");
 await category(page,"chart","Chart");
 for(const name of ["Hours","Date format","Grid"]) await expect(page.getByLabel(name,{exact:true})).toHaveJSProperty("tagName","SELECT");
 await category(page,"backtest","Backtest");
 for(const name of ["Sizing mode","Risk basis","Commission mode","Fee mode"]) await expect(page.getByLabel(name,{exact:true})).toHaveJSProperty("tagName","SELECT");
 await category(page,"data-providers","Data & providers");
 await expect(page.getByLabel("Instrument",{exact:true})).toHaveJSProperty("tagName","SELECT");
 await page.getByLabel("Instrument",{exact:true}).focus();
 await page.screenshot({path:path.join(root,".artifacts/settings-theme88-baseline-"+info.project.name+".png"),fullPage:true});
});

const modernOnly = () => test.skip(process.env.EDGELAB_SETTINGS_THEME88_BASELINE === "1");
const combo = (page, name) => page.getByRole("combobox", {name,exact:true});
const menu = async control => control.page().locator('[id="'+await control.getAttribute("aria-controls")+'"]');
async function choose(page,name,label) {
 const control=combo(page,name); await control.click(); await (await menu(control)).getByRole("option",{name:label,exact:true}).click();
 await expect(control).toHaveText(label); await expect(control).toHaveAttribute("aria-expanded","false");
}
async function cssToken(page,token,property="backgroundColor") {
 return page.evaluate(({token,property})=>{const el=document.createElement("span");el.style[property]="var("+token+")";document.body.append(el);const value=getComputedStyle(el)[property];el.remove();return value;},{token,property});
}
async function popupTokens(page, control) {
 await expect(control).toHaveJSProperty("tagName","BUTTON");
 await control.evaluate(el=>el.blur());
 await expect(control).toHaveCSS("border-top-color",await cssToken(page,"--ui-border-strong","borderTopColor"));
 await control.click(); const list=await menu(control); await expect(list).toBeVisible();
 await expect(list).toHaveCSS("background-color",await cssToken(page,"--ui-floating"));
 await expect(list).toHaveCSS("color",await cssToken(page,"--text-primary","color"));
 await expect(control).toHaveCSS("border-top-color",await cssToken(page,"--ui-focus","borderTopColor"));
 await expect(list.getByRole("option",{selected:true})).toHaveCSS("background-color",await cssToken(page,"--ui-selection"));
 await expect(list.getByRole("option",{selected:true})).toHaveCSS("color",await cssToken(page,"--text-primary","color"));
 expect(await list.evaluate(el=>el.closest("main")===null)).toBe(true);
 await control.press("Escape"); await expect(list).toBeHidden(); await expect(control).toBeFocused();
}

test("all eleven settings dropdowns use palette-owned popups and preserve genuine change contracts",async({page,harness})=>{
 modernOnly(); const {state,errors}=await open(page,harness);
 if(page.viewportSize().width<1024) await popupTokens(page,combo(page,"Settings category"));
 await popupTokens(page,combo(page,"Default entry type")); await choose(page,"Default entry type","Missed");
 expect(await page.evaluate(()=>window.settingsThemeFixture.current.journal.journalDraft.default_entry_type)).toBe("MISSED");
 await page.getByRole("button",{name:"Apply journal defaults",exact:true}).click();
 await expect(page.getByText("Journal defaults saved",{exact:true})).toBeVisible();
 expect(state.journal.settings.default_entry_type).toBe("MISSED");
 await category(page,"appearance","Appearance");
 await popupTokens(page,combo(page,"Settings density")); await choose(page,"Settings density","Compact");
 await expect.poll(()=>state.preferences.density).toBe("compact");
 await expect.poll(()=>page.evaluate(()=>window.settingsThemeFixture.current.preferences.defaults.density)).toBe("compact");
 await category(page,"chart","Chart");
 for(const [name,label] of [["Hours","24-hour"],["Date format","2026-12-31"],["Grid","None"]]) {
   await popupTokens(page,combo(page,name)); await choose(page,name,label);
 }
 expect(await page.evaluate(()=>{const d=window.settingsThemeFixture.current.chart.draft;return [d.timeHoursFormat,d.dateFormat,d.gridMode]})).toEqual(["24-hour","yyyy-MM-dd","none"]);
 await category(page,"backtest","Backtest");
 for(const [name,label,key,value] of [
   ["Sizing mode","Percent risk","order-sizing-mode.v1","risk"],
   ["Risk basis","Initial balance","order-risk-base.v1","INITIAL_BALANCE"],
   ["Commission mode","Fixed","order-commission-mode.v1","FIXED"],
   ["Fee mode","Percent","order-fee-mode.v1","PERCENT"]
 ]) {await popupTokens(page,combo(page,name));await choose(page,name,label);await expect.poll(()=>state.storage.get(key)).toBe(value);}
 await category(page,"data-providers","Data & providers");await popupTokens(page,combo(page,"Instrument"));
 const instrument=combo(page,"Instrument");await instrument.click();await instrument.press("End");await instrument.press("Enter");
 await expect(page.locator('[data-setting-control="asset-calibration"]').getByLabel("Currency",{exact:true})).toHaveValue("EUR");
 await category(page,"chart","Chart");await expect(combo(page,"Grid")).toHaveText("None");
 await category(page,"journal","Journal");await expect(combo(page,"Default entry type")).toHaveText("Missed");
 expect(errors).toEqual([]);
});

test("keyboard arrows, typeahead, Home/End, Escape and Tab retain focus and commit only chosen values",async({page,harness})=>{
 modernOnly();const {state,errors}=await open(page,harness);await category(page,"chart","Chart");
 const hours=combo(page,"Hours"),label=page.locator("label").filter({has:hours});
 await label.click({position:{x:8,y:8}});await expect(await menu(hours)).toBeVisible();await hours.press("Escape");await expect(hours).toBeFocused();
 const control=combo(page,"Grid");await control.focus();await control.press("ArrowDown");
 const list=await menu(control);await expect(list).toBeVisible();
 await control.press("End");await control.press("Enter");await expect(control).toHaveText("None");await expect(control).toBeFocused();
 await control.press("ArrowUp");await control.press("Home");await control.press("Escape");
 await expect(control).toHaveText("None");await expect(control).toBeFocused();
 await control.press("Space");await control.press("v");await control.press("Enter");await expect(control).toHaveText("Vertical");
 await control.press("ArrowDown");await control.press("Tab");await expect(list).toBeHidden();
 expect(state.writes).toEqual([]);expect(errors).toEqual([]);
});

test("a disabled parent fieldset closes the portal and prevents stale selection dispatch",async({page,harness})=>{
 modernOnly();const {errors}=await open(page,harness);await category(page,"chart","Chart");
 const control=combo(page,"Grid");const before=await control.innerText();await control.click();await expect(await menu(control)).toBeVisible();
 await control.evaluate(el=>{el.closest("fieldset").disabled=true});
 await expect(control).toBeDisabled();await expect(page.getByRole("listbox")).toHaveCount(0);
 await control.evaluate(el=>el.click());await expect(page.getByRole("listbox")).toHaveCount(0);await expect(control).toHaveText(before);
 await control.evaluate(el=>{el.closest("fieldset").disabled=false});
 await expect(control).toBeEnabled();await choose(page,"Grid","None");expect(errors).toEqual([]);
});

test("fresh-owner readiness and explicit disabled instruments close open menus until data is ready",async({page,harness})=>{
 modernOnly();const {state,errors}=await open(page,harness);await category(page,"chart","Chart");
 const control=combo(page,"Grid");await control.click();await expect(await menu(control)).toBeVisible();
 let release;state.holdChartRead=new Promise(resolve=>release=resolve);
 await page.evaluate(()=>window.settingsThemeFixture.switchOwner(8802));
 await expect(control).toBeDisabled();await expect(page.getByRole("listbox")).toHaveCount(0);
 await control.evaluate(el=>el.click());expect(await page.getByRole("listbox").count()).toBe(0);
 expect(state.writes).toEqual([]);release();await expect(control).toBeEnabled();await choose(page,"Grid","Horizontal");
 await category(page,"data-providers","Data & providers");const instrument=combo(page,"Instrument");await instrument.click();await expect(await menu(instrument)).toBeVisible();
 await page.evaluate(()=>window.settingsThemeFixture.datasets(false));
 await expect(instrument).toBeDisabled();await expect(page.getByRole("listbox")).toHaveCount(0);
 await page.evaluate(()=>window.settingsThemeFixture.datasets(true));await expect(instrument).toBeEnabled();
 expect(errors).toEqual([]);
});

test("long instrument menus stay inside the viewport through resize, scroll and keyboard selection",async({page,harness},info)=>{
 modernOnly();const {errors}=await open(page,harness);await category(page,"data-providers","Data & providers");
 const control=combo(page,"Instrument");await control.click();const list=await menu(control);
 await expect(list).toBeVisible();
 const geometry=async()=>list.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:el.scrollHeight,client:el.clientHeight,body:document.documentElement.scrollWidth}});
 const first=await geometry();expect(first.scroll).toBeGreaterThan(first.client);expect(first.left).toBeGreaterThanOrEqual(0);expect(first.right).toBeLessThanOrEqual(first.width);expect(first.bottom).toBeLessThanOrEqual(first.height);expect(first.body).toBeLessThanOrEqual(first.width);
 await page.setViewportSize({width:360,height:740});try{await expect.poll(async()=>{const r=await geometry();return r.right<=r.width&&r.bottom<=r.height&&r.left>=0}).toBe(true);}catch(error){const receipt=JSON.stringify({before:first,after:await geometry(),anchor:await control.boundingBox()});fs.writeFileSync(path.join(root,".artifacts/settings-theme88-resize-"+info.project.name+".json"),receipt);await info.attach("resize-geometry",{body:receipt,contentType:"application/json"});throw error;}
 await control.press("End");const last=list.getByRole("option").last();await expect(last).toBeVisible();
 await control.press("Enter");await expect(control).toContainText("Very long international");await expect(control).toBeFocused();
 await page.setViewportSize(info.project.name==="desktop"?{width:1440,height:1000}:{width:390,height:844});
 await control.press("ArrowDown");await expect(list).toBeVisible();await expect(list).toHaveCSS("opacity","1");await expect(list.getByRole("option",{selected:true})).toContainText("Very long international");
 await page.screenshot({path:path.join(root,".artifacts/settings-theme88-final-"+info.project.name+".png"),fullPage:false,animations:"disabled"});
 expect(errors).toEqual([]);
});

test("scoped token sentinels flow through real popup surfaces, switches, success icons and session helpers",async({page,harness})=>{
 modernOnly();const {errors}=await open(page,harness);
 // Fixture-only sentinels prove inheritance. The product still has one fixed Backlit palette.
 await page.evaluate(()=>{for(const [key,value] of Object.entries({
   "--ui-floating":"rgb(31, 42, 53)","--ui-selection":"rgb(61, 72, 83)","--text-primary":"rgb(211, 221, 231)",
   "--text-secondary":"rgb(151, 161, 171)","--ui-border-strong":"rgb(91, 101, 111)","--ui-focus":"rgb(121, 201, 181)",
   "--text-accent":"rgb(181, 191, 201)","--accent-primary":"rgb(181, 191, 201)","--profit-text":"rgb(141, 211, 151)","--ui-inset":"rgb(11, 21, 31)"
 }))document.body.style.setProperty(key,value);});
 await popupTokens(page,combo(page,"Default entry type"));
 await page.evaluate(()=>window.settingsThemeFixture.mode("semantic"));
 const row=page.locator('[data-setting-control="semantic-receipt"]');
 await expect(row.getByRole("link",{name:"Settings documentation"})).toHaveCSS("color",await cssToken(page,"--accent-primary","color"));
 await expect(row.getByRole("status").locator("svg")).toHaveCSS("color",await cssToken(page,"--profit-text","color"));
 const toggle=page.getByRole("switch",{name:"Semantic switch",exact:true});
 await expect(toggle).toHaveAttribute("aria-checked","true");await expect(toggle.locator(":scope > span")).toHaveCSS("background-color",await cssToken(page,"--ui-selection"));await expect(toggle.locator("span > span")).toHaveCSS("background-color",await cssToken(page,"--text-primary"));await toggle.click();await expect(toggle).toHaveAttribute("aria-checked","false");
 await expect(toggle.locator(":scope > span")).toHaveCSS("background-color",await cssToken(page,"--ui-inset"));
 await expect(page.getByText("Browser language",{exact:true})).toHaveCSS("color",await cssToken(page,"--text-secondary","color"));
 await expect(page.locator('[data-setting-control="credential-vault"] > div').last().getByText(/Use Data & providers/)).toHaveCSS("color",await cssToken(page,"--text-secondary","color"));
 await expect(page.getByRole("switch",{name:"Include diagnostics by default"}).locator("span").last()).toHaveCSS("color",await cssToken(page,"--accent-primary","color"));
 expect(errors).toEqual([]);
});

test("actual compatibility journal, chart and backtest paths retain native selects and change contracts",async({page,harness})=>{
 modernOnly();const {state,errors}=await open(page,harness);await page.evaluate(()=>window.settingsThemeFixture.mode("compatibility"));
 const entry=page.getByRole("combobox",{name:/^Default entry type/});await expect(entry).toHaveJSProperty("tagName","SELECT");await entry.selectOption("MISSED");
 for(const name of ["Hours","Date format","Grid","Settings density","Sizing mode","Risk basis","Commission mode","Fee mode"])for(const control of await page.getByLabel(name,{exact:true}).all())await expect(control).toHaveJSProperty("tagName","SELECT");
 await page.getByLabel("Settings density",{exact:true}).selectOption("compact");await expect.poll(()=>state.preferences.density).toBe("compact");
 await page.getByLabel("Sizing mode",{exact:true}).selectOption("risk");await expect.poll(()=>state.storage.get("order-sizing-mode.v1")).toBe("risk");
 expect(await page.evaluate(()=>window.settingsThemeFixture.current.journal.journalDraft.default_entry_type)).toBe("MISSED");
 expect(errors).toEqual([]);
});
