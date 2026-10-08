import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { betaSessionResponse, FROZEN_TIME, gotoStable } from "./support/app";
import { fulfillReplayContext, prepare, replayState } from "./support/replay-context";
import type { PineExecutionResult, PineResponse } from "../frontend/src/lib/pineProtocol";

const artifacts = path.resolve(".artifacts/pine-magnifier-editor115");
type Receipt = { operation_id: string; method: string; path: string; status: "reserved" | "completed"; http_status: number | null; result: null; created_at: string; completed_at: string | null };

declare global {
  interface Window {
    __nativeEditorResults: PineResponse[];
    __nativeChartMarkerPaint: Array<{ text: string; vertices: number; coloredPixels: number; connectedChart: boolean; bounds: number[] }>;
  }
}

import { minutes115 } from "../backend/tests/fixtures/pine-magnifier115.mjs";
const minutes=minutes115("high-first");
const start=minutes[0].time;
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
    if(endpoint==="/backtests/latest"){const original=replayState();await route.fulfill({json:{...original,session:{...original.session,timeframe:"1m",start_at:new Date(start*1000).toISOString(),end_at:new Date((start+(minutes.length-1)*60)*1000).toISOString(),current_offset:minutes.length-1,end_offset:minutes.length-1},current_candle:minutes.at(-1)}});return;}
    if(endpoint==="/market-data/meta"){await route.fulfill({json:{csv_path:"/fixtures/markets/BTCUSDT/1m.csv",rows:minutes.length,first_timestamp:new Date(start*1000).toISOString(),last_timestamp:new Date((start+(minutes.length-1)*60)*1000).toISOString()}});return;}
    if(endpoint==="/market-data/bars"){const url=new URL(request.url()),offset=Number(url.searchParams.get("offset")??0),limit=Number(url.searchParams.get("limit")??minutes.length);await route.fulfill({json:{bars:minutes.slice(offset,offset+limit).map(b=>({...b,timestamp:new Date(b.time*1000).toISOString(),ema_20:null,ema_50:null,rsi_14:null})),offset,limit,next_offset:offset+limit}});return;}
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
  // Observe the native marker's arrow pixels on the actual primary canvas.
  // The worker response, adapter, chart series and canvas operations remain real.
  await page.addInitScript(() => {
    window.__nativeChartMarkerPaint = [];
    const pending = new WeakMap<CanvasRenderingContext2D, { text: string; path: number[][] }>();
    const proto = CanvasRenderingContext2D.prototype;
    const nativeText = proto.fillText, nativeBegin = proto.beginPath;
    const nativeMove = proto.moveTo, nativeLine = proto.lineTo, nativeFill = proto.fill;
    proto.fillText = function (...args: Parameters<typeof nativeText>) {
      Reflect.apply(nativeText, this, args);
      if (/^Pine (entry|exit) /.test(String(args[0]))) pending.set(this, { text: String(args[0]), path: [] });
    };
    proto.beginPath = function () {
      nativeBegin.call(this);
      const marker = pending.get(this);
      if (marker) marker.path = [];
    };
    const record = (context: CanvasRenderingContext2D, x: number, y: number) => {
      const marker = pending.get(context);
      if (marker) {
        const point = new DOMPoint(x, y).matrixTransform(context.getTransform());
        marker.path.push([point.x, point.y]);
      }
    };
    proto.moveTo = function (x, y) { nativeMove.call(this, x, y); record(this, x, y); };
    proto.lineTo = function (x, y) { nativeLine.call(this, x, y); record(this, x, y); };
    proto.fill = function (...args: Parameters<typeof nativeFill>) {
      Reflect.apply(nativeFill, this, args);
      const marker = pending.get(this);
      if (!marker) return;
      pending.delete(this);
      if (marker.path.length < 3) return;
      const canvas = this.canvas;
      const x = Math.max(0, Math.floor(Math.min(...marker.path.map(point => point[0]))));
      const y = Math.max(0, Math.floor(Math.min(...marker.path.map(point => point[1]))));
      const width = Math.max(0, Math.min(canvas.width, Math.ceil(Math.max(...marker.path.map(point => point[0]))) + 1) - x);
      const height = Math.max(0, Math.min(canvas.height, Math.ceil(Math.max(...marker.path.map(point => point[1]))) + 1) - y);
      let coloredPixels = 0;
      const data = width && height ? this.getImageData(x, y, width, height).data : [];
      for (let index = 0; index < data.length; index += 4) {
        const expected = marker.text.startsWith("Pine entry") ? [34, 197, 94] : [251, 113, 133];
        if (data[index] === expected[0] && data[index + 1] === expected[1] && data[index + 2] === expected[2] && data[index + 3] > 0) coloredPixels++;
      }
      window.__nativeChartMarkerPaint.push({ text: marker.text, vertices: marker.path.length, coloredPixels,
        connectedChart: canvas.isConnected && !!canvas.closest(".chart-stage"), bounds: [x, y, width, height] });
    } as typeof nativeFill;
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



async function executionControls(editor: Locator) {
  const summary=editor.locator("summary").filter({hasText:/^Strategy test settings$/});
  await summary.scrollIntoViewIfNeeded();
  if(!await summary.evaluate(e=>(e.parentElement as HTMLDetailsElement).open))await summary.click();
  return summary.locator("..");
}

async function choose(page: Page, controls: Locator, name: string, option: string) {
  await controls.getByRole("combobox",{name,exact:true}).click();
  await page.getByRole("option",{name:option,exact:true}).click();
}

test("actual editor saves trader bar-detail settings and runs owned minute chronology after reload and on chart",async({page},info)=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));const state=await fixture(page);
 await viewFive(page);let editor=await openEditor(page);
 const source='//@version=6\nstrategy("Saved minute detail115",overlay=true,initial_capital=10000,use_bar_magnifier=false,calc_on_order_fills=false)\nprice=input.float(90,"Entry limit",minval=1,maxval=200)\nvarip int calls=-1\ncalls+=1\nif bar_index==0\n    strategy.entry("L",strategy.long,limit=price)\n    strategy.exit("X","L",limit=115)\nplot(calls,"Calls")\nplot(close,"Close")';
 await fillSource(editor,source);await check(editor);await editor.getByLabel("Entry limit",{exact:true}).fill("91");
 let controls=await executionControls(editor);
 await choose(page,controls,"Historical bar detail","Loaded smaller candles");
 await choose(page,controls,"Recalculate after fills","After fills and at candle close");
 const color=await controls.locator("summary").evaluate(e=>({color:getComputedStyle(e).color,token:getComputedStyle(e).getPropertyValue("--text-primary").trim()}));
 expect(color.token).not.toBe("");
 const resolve=await controls.locator("summary").evaluate(e=>{const n=document.createElement("span");n.style.color="var(--text-primary)";e.appendChild(n);const color=getComputedStyle(n).color;n.remove();return color;});
 expect(color.color).toBe(resolve);
 await controls.getByRole("combobox",{name:"Historical bar detail",exact:true}).click();
 await expect(page.getByRole("option",{name:"Loaded smaller candles",exact:true})).toBeVisible();
 fs.mkdirSync(path.join(artifacts,info.project.name),{recursive:true});
 await page.screenshot({path:path.join(artifacts,info.project.name,"settings.png")});
 await page.keyboard.press("Escape");
 await run(editor);const first=await nativeRun(page,source);
 const assertRun=(r:PineExecutionResult)=>{expect(r.source).toBe(source);expect(r.inputs).toEqual({in_0:91});expect(r.strategy?.config).toMatchObject({use_bar_magnifier:true,calc_on_order_fills:true});expect(r.strategy?.closedTrades).toHaveLength(0);expect(r.strategy?.openTrades).toHaveLength(1);expect(r.strategy?.openTrades[0]).toMatchObject({entry_price:91,entry_bar_index:1,entry_time:minutes[7].time});expect(points(r,"Calls")).toEqual([0,2]);expect(r.diagnostics.some(d=>d.code==="BAR_MAGNIFIER_COVERAGE"&&d.message.includes("2 of 2"))).toBe(true);};
 assertRun(first);
 await editor.getByRole("button",{name:"Save",exact:true}).click();
 await expect.poll(()=>((state.storage.get("custom-indicator-scripts.v1")??[])as any[]).some(s=>s.source===source)).toBe(true);
 const saved=((state.storage.get("custom-indicator-scripts.v1")??[])as any[]).find(s=>s.source===source);expect(saved.inputs).toEqual({in_0:91});expect(saved.strategySettings).toEqual({use_bar_magnifier:true,calc_on_order_fills:true});
 await page.reload();await expect(page.locator(".chart-stage canvas").first()).toBeVisible();await viewFive(page);editor=await openEditor(page);
 await editor.getByLabel("Script library",{exact:true}).selectOption(saved.id);controls=await executionControls(editor);
 await expect(controls.getByRole("combobox",{name:"Historical bar detail",exact:true})).toContainText("Loaded smaller candles");
 await expect(controls.getByRole("combobox",{name:"Recalculate after fills",exact:true})).toContainText("After fills and at candle close");
 await run(editor);const restored=await nativeRun(page,source);assertRun(restored);
 const before=await page.evaluate(source=>window.__nativeEditorResults.filter(r=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source).length,source);
 expect(await page.evaluate(() => window.__nativeChartMarkerPaint)).toEqual([]);
 await editor.getByRole("button",{name:"Add to chart",exact:true}).click();
 await expect.poll(()=>page.evaluate(source=>window.__nativeEditorResults.filter(r=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source).length,source)).toBeGreaterThan(before);
 const chartResult=await nativeRun(page,source);assertRun(chartResult);
 await editor.getByRole("button",{name:"Close indicator editor",exact:true}).click();
 await expect.poll(() => page.evaluate(() => window.__nativeChartMarkerPaint.some(marker =>
   marker.text === "Pine entry L" && marker.connectedChart && marker.vertices >= 7 && marker.coloredPixels > 0))).toBe(true);
 const markerPaint=await page.evaluate(() => window.__nativeChartMarkerPaint);
 expect(markerPaint.some(marker => marker.text.startsWith("Pine exit"))).toBe(false);
 expect(errors).toEqual([]);
 fs.writeFileSync(path.join(artifacts,info.project.name,"editor.json"),JSON.stringify({source,saved,first,restored,chartResult,markerPaint,color,errors},null,2));
});
