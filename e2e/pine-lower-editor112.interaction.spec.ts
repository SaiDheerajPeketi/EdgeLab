import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { betaSessionResponse, FROZEN_TIME, gotoStable } from "./support/app";
import { fulfillReplayContext, prepare, replayState } from "./support/replay-context";
import type { PineExecutionResult, PineResponse } from "../frontend/src/lib/pineProtocol";

const artifacts = path.resolve(".artifacts/pine-lower-editor112");
type Receipt = { operation_id: string; method: string; path: string; status: "reserved" | "completed"; http_status: number | null; result: null; created_at: string; completed_at: string | null };

declare global {
  interface Window {
    __nativeEditorResults: PineResponse[];
  }
}

const start=1_700_000_100;
let state=0x112;
const minutes=Array.from({length:40},(_,i)=>{const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};const open=80+next()%41,close=80+next()%41;return {time:start+i*60,open,close,high:Math.max(open,close)+1+next()%6,low:Math.min(open,close)-1-next()%6,volume:100+next()%201};});
const points=(r:any,n:string)=>r.plots.find((p:any)=>p.name===n).points.map((p:any)=>p.value);


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
    if(endpoint==="/backtests/latest"){const original=replayState();await route.fulfill({json:{...original,session:{...original.session,timeframe:"1m",start_at:new Date(start*1000).toISOString(),end_at:new Date((start+39*60)*1000).toISOString(),current_offset:39,end_offset:39},current_candle:minutes[39]}});return;}
    if(endpoint==="/market-data/meta"){await route.fulfill({json:{csv_path:"/fixtures/markets/BTCUSDT/1m.csv",rows:40,first_timestamp:new Date(start*1000).toISOString(),last_timestamp:new Date((start+39*60)*1000).toISOString()}});return;}
    if(endpoint==="/market-data/bars"){const url=new URL(request.url()),offset=Number(url.searchParams.get("offset")??0),limit=Number(url.searchParams.get("limit")??40);await route.fulfill({json:{bars:minutes.slice(offset,offset+limit).map(b=>({...b,timestamp:new Date(b.time*1000).toISOString(),ema_20:null,ema_50:null,rsi_14:null})),offset,limit,next_offset:offset+limit}});return;}
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
    window.__nativeEditorResults = [];
    addEventListener("message", (event) => {
      const actual = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find((frame) => frame.contentWindow === event.source && frame.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (actual && event.origin === "null" && event.data?.type === "result") {
        window.__nativeEditorResults.push(event.data.payload);

      }
    }, true);
  });
  await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  return { storage, writes, identity };
}

async function viewFive(page: Page) {
  if (!await page.getByRole("button",{name:"5m",exact:true}).first().isVisible()) await page.getByRole("button",{name:"Tools",exact:true}).first().click();
  await page.getByRole("button",{name:"5m",exact:true}).first().click();
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
  await expect.poll(() => page.evaluate((expected) => window.__nativeEditorResults.filter((item) => item.status === "completed" && item.result.kind === "run" && item.result.source === expected).length, source)).toBeGreaterThan(0);
  return page.evaluate((expected) => {
    const found = [...window.__nativeEditorResults].reverse().find((item) => item.status === "completed" && item.result.kind === "run" && item.result.source === expected);
    return found?.status === "completed" ? found.result as PineExecutionResult : null;
  }, source).then((result) => { expect(result).not.toBeNull(); return result!; });
}


test("actual replay editor forwards M1 provenance through 5m aggregation, saved inputs and chart runtime",async({page},info)=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));const state=await fixture(page);
 await viewFive(page);
 let editor=await openEditor(page);
 const source='//@version=6\nindicator("Owned lower editor112",overlay=true,dynamic_requests=false)\namount=input.int(2,"Amount",minval=0,maxval=20)\na=request.security_lower_tf("","1",close+amount)\nplot(array.size(a),"Count")\nplot(array.get(a,0),"First")\nplot(array.get(a,array.size(a)-1),"Last")\nplot(request.security("","1",close+amount,lookahead=barmerge.lookahead_on),"On")';
 await fillSource(editor,source);await check(editor);await editor.getByLabel("Amount",{exact:true}).fill("7");await run(editor);
 const first=await nativeRun(page,source);expect(first.source).toBe(source);expect(first.inputs).toMatchObject({in_0:7});
 const expected=(r:any,n:string,amount:number)=>r.plots.find((p:any)=>p.name===n).points.map((p:any)=>{const group=minutes.filter(b=>b.time>=p.time&&b.time<p.time+300);expect(group.length).toBeGreaterThan(0);return n==="Count"?group.length:n==="Last"?group.at(-1)!.close+amount:group[0].close+amount;});
 for(const n of ["Count","First","Last","On"])expect(points(first,n)).toEqual(expected(first,n,7));
 expect(first.plots[0].points).toHaveLength(8);
 await editor.getByRole("button",{name:"Save",exact:true}).click();
 await expect.poll(()=>((state.storage.get("custom-indicator-scripts.v1")??[])as any[]).some(s=>s.source===source)).toBe(true);
 const saved=((state.storage.get("custom-indicator-scripts.v1")??[])as any[]).find(s=>s.source===source);expect(saved.inputs).toMatchObject({in_0:7});expect(saved.pinePrepared.inputDefinitions.map((d:any)=>d.id)).toEqual(["in_0"]);
 await page.reload();await expect(page.locator(".chart-stage canvas").first()).toBeVisible();await viewFive(page);editor=await openEditor(page);
 await editor.getByLabel("Script library",{exact:true}).selectOption(saved.id);await run(editor);const restored=await nativeRun(page,source);expect(restored.inputs).toMatchObject({in_0:7});expect(restored.source).toBe(source);
 const before=await page.evaluate(source=>window.__nativeEditorResults.filter(r=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source).length,source);
 await editor.getByRole("button",{name:"Add to chart",exact:true}).click();
 await expect.poll(()=>page.evaluate(source=>window.__nativeEditorResults.filter(r=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source).length,source)).toBeGreaterThan(before);
 const chartResult=await nativeRun(page,source);for(const n of ["Count","First","Last","On"])expect(points(chartResult,n)).toEqual(expected(chartResult,n,7));expect(errors).toEqual([]);
 fs.mkdirSync(path.join(artifacts,info.project.name),{recursive:true});fs.writeFileSync(path.join(artifacts,info.project.name,"editor.json"),JSON.stringify({source,saved,first,restored,chartResult,errors},null,2));
});
