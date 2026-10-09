import { selectPineCatalogScript } from "./support/pine-catalog-selection";
import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { betaSessionResponse, FROZEN_TIME, gotoStable } from "./support/app";
import { fulfillReplayContext, prepare } from "./support/replay-context";
type Receipt = { operation_id: string; method: string; path: string; status: "reserved" | "completed"; http_status: number | null; result: null; created_at: string; completed_at: string | null };
const catalog=JSON.parse(fs.readFileSync(path.resolve("frontend/src/lib/pineCatalogManifestV2.json"),"utf8"));
const root="/catalog/pine/everget-v2",commit=catalog.upstreamCommit;
const original=(entry:any)=>fs.readFileSync(path.resolve("frontend/public"+root,commit,entry.path),"utf8");
const edited='//@version=6\nindicator("Recovery119 saved copy", overlay=true)\nlength=input.int(3,"Length",minval=1)\nplot(ta.sma(close,length),"Personal")\n// user saved copy';
const scripts=(state:any)=>state.storage.get("custom-indicator-scripts.v1")??[];
const chartSources=(value:any):string[]=>!value||typeof value!=="object"?[]:Array.isArray(value)?value.flatMap(chartSources):[...(value.kind==="custom"&&typeof value.customScriptSource==="string"?[value.customScriptSource]:[]),...Object.values(value).flatMap(chartSources)];
async function fixture(page: Page) {
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
  await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  return { storage, writes, identity };
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

async function importEntry(editor:Locator,entry:any){
 const browser=editor.locator("details").filter({hasText:"Community Pine catalog"});
 if(!await browser.evaluate(e=>(e as HTMLDetailsElement).open))await browser.locator("summary").click();
 await selectPineCatalogScript(browser, entry.id);
 await browser.getByRole("button",{name:"View source",exact:true}).click();
 await expect(browser.getByLabel(entry.name+" original source",{exact:true})).toHaveText(original(entry));
 await browser.getByRole("button",{name:entry.pineVersion<5?"Import migrated draft":"Import draft",exact:true}).click();
 await expect(editor.getByLabel("EdgeLab indicator source",{exact:true})).toHaveValue(entry.pineVersion<5?/\/\/@version=5/:original(entry));
 await expect(editor.getByRole("region",{name:"Catalog source attribution",exact:true})).toBeVisible();
}
async function savedDraft(page:Page,entry:any){
 const state=await fixture(page),editor=await openEditor(page);
 await importEntry(editor,entry);await fillSource(editor,edited);await check(editor);
 await editor.getByRole("button",{name:"Save",exact:true}).click();
 await expect.poll(()=>scripts(state).length).toBe(1);
 expect(scripts(state)[0].source).toBe(edited);expect(scripts(state)[0].catalogOrigin.catalogId).toBe(entry.id);
 expect(scripts(state)[0].versions).toEqual([]);
 return {state,editor};
}
const recovery=(editor:Locator)=>editor.getByRole("button",{name:"Recover original source",exact:true});
const preview=(editor:Locator)=>editor.getByLabel("Archived original source",{exact:true});
async function unchanged(state:any,editor:Locator,saved:any,chart:string[],source=edited){
 await expect(editor.getByLabel("EdgeLab indicator source",{exact:true})).toHaveValue(source);
 expect(scripts(state)).toEqual(saved);expect(chartSources(state.storage.get("chart-layout.v1"))).toEqual(chart);
}
test("saved original recovers its immutable revision despite newer current catalog, only after explicit acceptance",async({page},info)=>{
 const entry=catalog.entries.find((e:any)=>e.name==="Parabolic SAR"),initial=await savedDraft(page,entry),state=initial.state;let editor=initial.editor;
 await editor.getByRole("button",{name:"Add to chart",exact:true}).click();
 await editor.getByRole("button",{name:"Close indicator editor",exact:true}).click();
 const saveLayout=page.getByRole("button",{name:"Workspace",exact:true});
 if(!await saveLayout.isVisible())await page.getByRole("button",{name:"Tools",exact:true}).first().click();
 await saveLayout.click();
 const workspace=page.getByRole("dialog",{name:"Workspace controls",exact:true});
 await workspace.getByPlaceholder("Layout name",{exact:true}).fill("Original119 immutable chart");
 await workspace.getByRole("button",{name:"Save",exact:true}).click();await page.keyboard.press("Escape");
 await expect.poll(()=>chartSources(state.storage.get("chart-layout.v1")).includes(edited)).toBe(true);
 editor=await openEditor(page);await editor.getByRole("combobox",{name:"Script library",exact:true}).selectOption(scripts(state)[0].id);
 const saved=structuredClone(scripts(state)),chart=chartSources(state.storage.get("chart-layout.v1")),layout=structuredClone(state.storage.get("chart-layout.v1")),writeCount=state.writes.filter(w=>["custom-indicator-scripts.v1","chart-layout.v1"].includes(w.key)).length;
 // Current catalog deliberately excludes the saved revision. Recovery must use
 // its saved immutable provenance, without consulting the current index.
 const newer="b".repeat(40),latest={...catalog,upstreamCommit:newer,entries:catalog.entries.map((e:any)=>({...e,originUrl:"https://github.com/"+catalog.repository+"/blob/"+newer+"/"+e.path}))};
 await page.route("**"+root+"/index.json",r=>r.fulfill({json:{schemaVersion:1,repository:catalog.repository,revisions:[newer],currentRevision:newer}}));
 await page.route("**"+root+"/"+newer+"/manifest.json",r=>r.fulfill({json:latest}));
 const browser=editor.locator("details").filter({hasText:"Community Pine catalog"});
 if(!await browser.evaluate(e=>(e as HTMLDetailsElement).open))await browser.locator("summary").click();
 await browser.getByRole("button",{name:"Reload catalog",exact:true}).click();
 await expect(browser.getByRole("status")).toContainText("New catalog revision loaded");
 await recovery(editor).click();await expect(preview(editor)).toHaveText(original(entry));expect(await preview(editor).textContent()).toBe(original(entry));
 await unchanged(state,editor,saved,chart);
 await editor.getByRole("button",{name:"Keep my draft",exact:true}).click();await expect(preview(editor)).toBeHidden();await expect(recovery(editor)).toBeFocused();
 await unchanged(state,editor,saved,chart);
 await recovery(editor).click();await expect(preview(editor)).toBeVisible();
 const colors=await preview(editor).evaluate(e=>{const p=getComputedStyle(e),s=document.createElement("span");e.append(s);s.style.color="var(--text-primary)";s.style.backgroundColor="var(--ui-inset)";const c=getComputedStyle(s),out={ink:p.color,surface:p.backgroundColor,expectedInk:c.color,expectedSurface:c.backgroundColor};s.remove();return out;});
 expect(colors.ink).toBe(colors.expectedInk);expect(colors.surface).toBe(colors.expectedSurface);
 await preview(editor).scrollIntoViewIfNeeded();const bounds=await preview(editor).boundingBox();expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
 const artifacts=path.resolve(".artifacts/pine-catalog-original119",info.project.name);fs.mkdirSync(artifacts,{recursive:true});if(process.env.EDGELAB_PINE_ORIGINAL119_CAPTURE!=="0")await page.screenshot({path:path.join(artifacts,"original-preview.png"),animations:"disabled"});
 await editor.getByRole("button",{name:"Open original as new draft",exact:true}).click();
 await expect(editor.getByLabel("EdgeLab indicator source",{exact:true})).toHaveValue(original(entry));await expect(editor.getByRole("combobox",{name:"Script library",exact:true})).toHaveValue("");
 await expect(editor.getByRole("button",{name:"Save",exact:true})).toBeDisabled();await expect(editor.getByRole("button",{name:"Add to chart",exact:true})).toBeDisabled();await expect(preview(editor)).toBeHidden();
 expect(scripts(state)).toEqual(saved);expect(chartSources(state.storage.get("chart-layout.v1"))).toEqual(chart);
 expect(state.storage.get("chart-layout.v1")).toEqual(layout);expect(state.writes.filter(w=>["custom-indicator-scripts.v1","chart-layout.v1"].includes(w.key))).toHaveLength(writeCount);
 fs.writeFileSync(path.join(artifacts,"receipt.json"),JSON.stringify({protectedWriteCount:writeCount,revision:commit,current:newer,bytes:Buffer.byteLength(original(entry)),colors,bounds,savedSourceUnchanged:true,activeChartSourceUnchanged:true},null,2));
});
test("unavailable original retries, held recovery cancels safely, draft changes reject stale previews, legacy acceptance remains raw",async({page})=>{
 const entry=catalog.entries.find((e:any)=>e.name==="Hull Moving Average"),{state,editor}=await savedDraft(page,entry);
 const saved=structuredClone(scripts(state)),chart=chartSources(state.storage.get("chart-layout.v1"));
 let mode:"fail"|"held"|"ok"="fail",release=()=>{},reached=false;
 await page.route("**"+root+"/"+commit+"/"+entry.path,async route=>{
  if(mode==="held"){reached=true;await new Promise<void>(r=>{release=r;});}
  try{await route.fulfill(mode==="fail"?{status:404,body:"Unavailable"}:{body:original(entry),contentType:"text/plain"});}catch{/* An aborted owned fetch cannot stage a preview. */}
 });
 await recovery(editor).click();await expect(editor.getByRole("alert").filter({hasText:"Your draft is unchanged"})).toBeVisible();await unchanged(state,editor,saved,chart);
 mode="ok";await recovery(editor).click();await expect(preview(editor)).toHaveText(original(entry));await editor.getByRole("button",{name:"Keep my draft",exact:true}).click();
 mode="held";await recovery(editor).click();await expect.poll(()=>reached).toBe(true);await editor.getByRole("button",{name:"Cancel recovery",exact:true}).click();await expect(recovery(editor)).toBeFocused();release();await expect(preview(editor)).toBeHidden();await unchanged(state,editor,saved,chart);
 reached=false;await recovery(editor).click();await expect.poll(()=>reached).toBe(true);const newer=edited+"\n// newer unsaved edit";await fillSource(editor,newer);release();await expect(editor.getByRole("button",{name:"Loading original…",exact:true})).toBeHidden();await expect(preview(editor)).toBeHidden();await unchanged(state,editor,saved,chart,newer);
 mode="ok";await recovery(editor).click();await expect(preview(editor)).toHaveText(original(entry));await fillSource(editor,newer+"\n// another edit");await expect(preview(editor)).toBeHidden();
 await recovery(editor).click();await expect(preview(editor)).toBeVisible();await editor.getByRole("button",{name:"Open original as new draft",exact:true}).click();
 await expect(editor.getByLabel("EdgeLab indicator source",{exact:true})).toHaveValue(original(entry));expect(original(entry)).toContain("//@version=3");await expect(editor.getByRole("region",{name:"Catalog source attribution",exact:true})).toContainText("Unmodified original source");
 await expect(editor.getByRole("button",{name:"Save",exact:true})).toBeDisabled();await expect(editor.getByRole("button",{name:"Add to chart",exact:true})).toBeDisabled();expect(scripts(state)).toEqual(saved);expect(chartSources(state.storage.get("chart-layout.v1"))).toEqual(chart);
});
