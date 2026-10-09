import { test as base, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { productSetup, editor, checkedRun } from "./pine-layering.product-support";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, ".artifacts/pine-live58/browser");
const candle = (index: number, close: number) => ({ time: 1_700_000_040 + index * 60, open: close - 1, high: close + 2, low: close - 2, close, volume: 10 });
const bars = [10, 20, 30, 40].map((value, index) => candle(index, value));
const source = `//@version=6
indicator("Persistent browser oracle",overlay=true)
increment=input.int(1,"Increment")
var int ordinary=0
varip int ticks=0
ordinary+=increment
ticks+=increment
plot(ordinary,"Ordinary")
plot(ticks,"Ticks")
plot(ta.ema(close,3),"EMA")
plot(barstate.ishistory,"History")
plot(barstate.isconfirmed,"Confirmed")
plot(barstate.isnew,"New")`;
const input = (text = source, snapshot = bars) => ({ source: text, bars: snapshot, context: { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 }, inputs: {} });
type Harness = { origin: string; workerName: string; workerBytes: number; workerSha256: string; requests: string[] };
const fixture = `
import { createPineLiveRuntimeSession, createPineRuntimeJob } from './pineRuntime';
import { getPackedPinePlot, pointAtBar } from './pinePacked';
const sessions=new Map();
const outcomes=new Map();
let ordinal=0;
function outcome(promise){return promise.then(value=>({ok:true,value}),error=>({ok:false,error:{code:error.code,name:error.name,message:error.message}}));}
function observe(state){
  state.listener=event=>{
    if(!state.frame||event.source!==state.frame.contentWindow||event.origin!=='null'||event.data?.nonce!==state.nonce)return;
    if(event.data.type==='result'){
      const wire=event.data.payload;
      state.wires.set(wire.sequence,wire);
      if(state.hold===wire.sequence){state.held=event;event.stopImmediatePropagation();}
    }
    if(event.data.type==='stopped')state.stopped++;
  };
  window.addEventListener('message',state.listener,true);
}
export function start(input,hold=-1){
  const existing=new Set(document.querySelectorAll('iframe'));
  const state={session:null,frame:null,nonce:null,wires:new Map(),hold,held:null,stopped:0};
  observe(state);
  const session=createPineLiveRuntimeSession(input);
  const frame=[...document.querySelectorAll('iframe')].find(item=>!existing.has(item));
  Object.assign(state,{session,frame,nonce:frame.srcdoc.match(/data-job="([a-f0-9]+)"/)[1]});
  sessions.set(session.id,state);outcomes.set(session.id+':0',outcome(session.promise));return session.id;
}
export function update(id,bar,confirmed=false){const key=id+':'+(++ordinal);outcomes.set(key,outcome(sessions.get(id).session.update(bar,confirmed)));return key;}
export async function result(key){const result=await outcomes.get(key);if(!result.ok)return result;const value=result.value;return {ok:true,source:value.source,audit:value.audit,inputs:value.inputs,plots:value.plots.map(plot=>({name:plot.name,points:plot.points.length,first:pointAtBar(plot,0)??plot.points[0],last:pointAtBar(plot,value.audit.bars-1)??plot.points.at(-1),times:[...plot.points].map(point=>point.time),values:[...plot.points].map(point=>point.value)}))};}
export function hold(id,sequence){sessions.get(id).hold=sequence;}
export function release(id,mutation){const state=sessions.get(id),event=state.held;if(!event)throw Error('No genuine held result');state.hold=-1;state.held=null;
  const data=event.data;
  if(mutation==='sequence')data.payload.sequence++;
  if(mutation==='session')data.payload.sessionId='foreign-session-000000';
  if(mutation==='packed-kind'){const wire=data.payload.response;new Uint8Array(wire.buffers[wire.result.plots[0].packed.kinds])[0]=255;}
  window.dispatchEvent(new MessageEvent('message',{data,source:event.source,origin:event.origin,ports:event.ports}));
}
export function spoof(id){const state=sessions.get(id);window.postMessage({nonce:state.nonce,type:'result',payload:{protocol:'pine-live-v1',sessionId:id,sequence:0,response:{}}},'*');}
export function summary(id){const state=sessions.get(id);return {connected:state.frame.isConnected,opaque:state.frame.getAttribute('sandbox')==='allow-scripts',frames:document.querySelectorAll('iframe[sandbox="allow-scripts"]').length,held:!!state.held,stopped:state.stopped,sequences:[...state.wires.keys()],srcdocLeaksSource:state.frame.srcdoc.includes('Persistent browser oracle')};}
export async function ownership(id,key,sequence){const result=await outcomes.get(key);if(!result.ok)return result;const wire=sessions.get(id).wires.get(sequence).response,value=result.value;return {ok:true,encoding:wire.encoding,bufferBytes:wire.buffers.map(buffer=>buffer.byteLength),metadataBytes:new TextEncoder().encode(JSON.stringify({...wire,buffers:[]})).length,plots:value.plots.map(plot=>{const view=getPackedPinePlot(plot);return {packed:!!view,owned:view?[view.values.buffer,view.kinds.buffer,view.optionIndices.buffer].every(buffer=>wire.buffers.includes(buffer)):false,last:pointAtBar(plot,value.audit.bars-1)};}),fresh:sequence===0||wire.buffers.every(buffer=>!sessions.get(id).wires.get(sequence-1).response.buffers.includes(buffer))};}
export function cancel(id){const state=sessions.get(id);state.session.cancel();window.removeEventListener('message',state.listener,true);}
export async function snapshot(input){const job=createPineRuntimeJob({...input,action:'run',mode:'historical'});return outcome(job.promise);}
`;

const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const assets = path.join(root, "frontend/dist/assets");
    const workerName = fs.readdirSync(assets).find((name) => /^pine-native-worker.*\.js$/.test(name))!;
    const worker = fs.readFileSync(path.join(assets, workerName));
    const workerPath = `/assets/${workerName}`;
    const output = await build({
      stdin: { contents: fixture, resolveDir: path.join(root, "frontend/src/lib"), sourcefile: "pine-live58-parent.ts", loader: "ts" },
      bundle: true, write: false, platform: "browser", format: "iife", globalName: "live58",
      plugins: [{ name: "actual-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "live58" }));
        builder.onLoad({ filter: /.*/, namespace: "live58" }, () => ({ contents: `export default ${JSON.stringify(workerPath)}`, loader: "js" }));
      } }],
    });
    const requests: string[] = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      requests.push(pathname);
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end('<!doctype html><title>Real persistent Pine isolate</title><h1>Persistent isolate proof</h1><script src="/fixture.js"></script>');
      } else if (pathname === "/fixture.js") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(output.outputFiles[0].contents);
      } else if (pathname === workerPath) {
        response.setHeader("Content-Type", "text/javascript");
        response.end(worker);
      } else if (pathname === "/favicon.ico") {
        response.statusCode = 204;
        response.end();
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    await use({ origin: `http://127.0.0.1:${address.port}`, workerName, workerBytes: worker.length, workerSha256: createHash("sha256").update(worker).digest("hex"), requests });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }, { scope: "worker" }],
  harness: async ({ serverHarness, page }, use) => {
    await page.goto(serverHarness.origin);
    await use(serverHarness);
  },
});
const api = (page: Page, fn: string, args: any[]) => page.evaluate(({ fn, args }) => (window as any).live58[fn](...args), { fn, args });
const plot = (result: any, name: string) => result.plots.find((item: any) => item.name === name);
function save(info: any, name: string, value: any) {
  const directory = path.join(artifacts, info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(value, null, 2));
}

// Only the parent observes authentic messages. The opaque frame, fixed bridge,
// production worker bytes and engine are never replaced or instrumented.
test("one opaque isolate retains ordinary rollback and varip through 64 received events", async ({ page, harness }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const id = await api(page, "start", [input()]);
  const initial = await api(page, "result", [`${id}:0`]);
  expect(initial.ok).toBe(true);
  expect(plot(initial, "Ticks").values).toEqual([1, 2, 3, 4]);
  expect(plot(initial, "History").values).toEqual([true, true, true, true]);
  const original = await api(page, "summary", [id]);
  expect(original).toMatchObject({ connected: true, opaque: true, frames: 1, srcdocLeaksSource: false });
  let latest: any;
  for (let index = 0; index < 65; index++) {
    const key = await api(page, "update", [id, candle(4, 50 + index), false]);
    latest = await api(page, "result", [key]);
    expect(latest.ok).toBe(true);
    expect(plot(latest, "Ordinary").values).toEqual([1, 2, 3, 4, 5]);
    expect(plot(latest, "Ticks").values).toEqual([1, 2, 3, 4, 5 + index]);
    expect(plot(latest, "EMA").last.value).toBe((30 + 50 + index) / 2);
    expect(new Set(plot(latest, "Ticks").times).size).toBe(5);
  }
  const identical = await api(page, "update", [id, candle(4, 114), false]);
  expect(plot(await api(page, "result", [identical]), "Ticks").last.value).toBe(70);
  const close = await api(page, "update", [id, candle(4, 114), true]);
  expect(plot(await api(page, "result", [close]), "Ticks").last.value).toBe(71);
  const next = await api(page, "update", [id, candle(5, 120), false]);
  const appended = await api(page, "result", [next]);
  expect(plot(appended, "Ordinary").last.value).toBe(6);
  expect(plot(appended, "Ticks").last.value).toBe(72);
  expect(plot(appended, "New").last.value).toBe(true);
  expect(await api(page, "summary", [id])).toMatchObject({ connected: true, frames: 1 });
  await api(page, "cancel", [id]);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  save(info, "persistent-events", { harness, initial, latest, appended, errors });
});

test("fresh packed receiver ownership survives updates without detaching retained engine state", async ({ page, harness }, info) => {
  const snapshot = Array.from({ length: 600 }, (_, index) => candle(index, index + 1));
  const text = `//@version=6\nindicator("Packed persistent",overlay=true)\n${Array.from({ length: 8 }, (_, index) => `plot(close+${index},"Channel ${index}")`).join("\n")}`;
  const id = await api(page, "start", [input(text, snapshot)]);
  const initial = await api(page, "ownership", [id, `${id}:0`, 0]);
  expect(initial.encoding).toBe("pine-packed-v1");
  expect(initial.metadataBytes).toBeLessThan(1_000_000);
  expect(initial.bufferBytes).toEqual(Array.from({ length: 8 }, () => [4800, 600, 1200]).flat());
  expect(initial.plots.every((item: any) => item.packed && item.owned)).toBe(true);
  const key = await api(page, "update", [id, candle(600, 700), false]);
  const next = await api(page, "ownership", [id, key, 1]);
  expect(next.fresh).toBe(true);
  expect(next.plots.every((item: any) => item.packed && item.owned)).toBe(true);
  expect(next.plots[7].last.value).toBe(707);
  expect(initial.plots[7].last.value).toBe(607);
  expect(await api(page, "summary", [id])).toMatchObject({ frames: 1, connected: true });
  await api(page, "cancel", [id]);
  save(info, "packed-ownership", { harness, initial, next, senderDetachmentScope: "Real transferable sender detachment is independently asserted in the minified worker Node test; this browser observes received buffer identity and fresh snapshots." });
});

test("bounded queue cancels every owned request and a fresh session still works", async ({ page, harness }, info) => {
  test.skip(info.project.name !== "desktop", "Transport boundary is viewport independent.");
  const id = await api(page, "start", [input()]);
  expect((await api(page, "result", [`${id}:0`])).ok).toBe(true);
  await api(page, "hold", [id, 1]);
  const orderedFirst = await api(page, "update", [id, candle(4, 50), false]);
  await expect.poll(() => api(page, "summary", [id])).toMatchObject({ held: true });
  const orderedSecond = await api(page, "update", [id, candle(4, 51), false]);
  const orderedThird = await api(page, "update", [id, candle(4, 52), false]);
  await api(page, "release", [id]);
  const ordered = await Promise.all([orderedFirst, orderedSecond, orderedThird].map((key) => api(page, "result", [key])));
  expect(ordered.map((result) => plot(result, "Ticks").last.value)).toEqual([5, 6, 7]);
  expect(ordered.map((result) => plot(result, "EMA").last.value)).toEqual([40, 40.5, 41]);
  expect((await api(page, "summary", [id])).sequences).toEqual([0, 1, 2, 3]);
  await api(page, "hold", [id, 4]);
  const first = await api(page, "update", [id, candle(4, 53), false]);
  await expect.poll(() => api(page, "summary", [id])).toMatchObject({ held: true });
  const keys = await page.evaluate(({ id, bar }) => Array.from({ length: 33 }, () => (window as any).live58.update(id, bar, false)), { id, bar: candle(4, 50) });
  const outcomes = await Promise.all([first, ...keys].map((key) => api(page, "result", [key])));
  expect(outcomes.every((outcome) => !outcome.ok && outcome.error.code === "QUEUE_LIMIT")).toBe(true);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  const changed = { ...input(), inputs: { in_0: 2 }, context: { ...input().context, symbol: "FRESH" } };
  const fresh = await api(page, "start", [changed]);
  const freshResult = await api(page, "result", [`${fresh}:0`]);
  expect(plot(freshResult, "Ticks").last.value).toBe(8);
  expect(freshResult.inputs).toEqual({ in_0: 2 });
  await api(page, "hold", [fresh, 1]);
  const pending = await api(page, "update", [fresh, candle(4, 50), false]);
  await expect.poll(() => api(page, "summary", [fresh])).toMatchObject({ held: true });
  const queued = await api(page, "update", [fresh, candle(4, 51), false]);
  await api(page, "cancel", [fresh]);
  expect((await api(page, "result", [pending])).error.code).toBe("CANCELLED");
  expect((await api(page, "result", [queued])).error.code).toBe("CANCELLED");
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  // Late authentic ownership cannot revive a canceled listener/session.
  await api(page, "release", [fresh]);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  const initializing = await api(page, "start", [input()]);
  await api(page, "cancel", [initializing]);
  expect((await api(page, "result", [initializing + ":0"])).error.code).toBe("CANCELLED");
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  const ordinary = await api(page, "snapshot", [input()]);
  expect(ordinary.ok).toBe(true);
  expect(ordinary.value.audit.mode).toBe("historical");
  save(info, "queue-recovery", { harness, ordered, outcomes });
});

test("foreign parent messages cannot finish a live request and missing owned delivery expires", async ({ page, harness }, info) => {
  test.skip(info.project.name !== "desktop", "Transport boundary is viewport independent.");
  const id = await api(page, "start", [input()]);
  await api(page, "result", [`${id}:0`]);
  await api(page, "hold", [id, 1]);
  const key = await api(page, "update", [id, candle(4, 50), false]);
  await expect.poll(() => api(page, "summary", [id])).toMatchObject({ held: true });
  await api(page, "spoof", [id]);
  const outcome = await api(page, "result", [key]);
  expect(outcome.ok).toBe(false);
  expect(outcome.error.code).toBe("TIME_LIMIT");
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  save(info, "deadline-source-owner", { harness, outcome, scope: "Genuine worker result delivery held by parent observer; per-message delivery deadline, not a claim of CPU hang." });
});

test("owned malformed packed responses and mismatched envelopes fail closed", async ({ page, harness }, info) => {
  test.skip(info.project.name !== "desktop", "Transport boundary is viewport independent.");
  const snapshot = Array.from({ length: 600 }, (_, index) => candle(index, index + 1));
  const text = `//@version=6\nindicator("Forged packed")\n${Array.from({ length: 8 }, (_, index) => `plot(close,"C${index}")`).join("\n")}`;
  const failures = [];
  for (const mutation of ["sequence", "session", "packed-kind"]) {
    const id = await api(page, "start", [input(text, snapshot), 0]);
    await expect.poll(() => api(page, "summary", [id])).toMatchObject({ held: true });
    await api(page, "release", [id, mutation]);
    const result = await api(page, "result", [`${id}:0`]);
    expect(result.ok).toBe(false);
    expect(["INVALID_LIVE_MESSAGE", "INVALID_MESSAGE", "INVALID_RESULT"]).toContain(result.error.code);
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
    failures.push({ mutation, result });
  }
  save(info, "malformed-owned-response", { harness, failures });
});

const productTitle = "Live tick oracle";
const productSource = `//@version=6
indicator("${productTitle}",overlay=true,behind_chart=false)
increment=input.int(1,"Increment",minval=1,maxval=3)
shade=input.color(#ff0000,"Shade")
var int ordinary=0
varip int ticks=0
ordinary+=increment
ticks+=increment
plot(ordinary,"Ordinary",display=display.none)
plot(ticks,"Ticks",display=display.none)
plot(ta.ema(close,3),"EMA",display=display.none)
plot(barstate.ishistory,"History",display=display.none)
plot(barstate.isconfirmed,"Confirmed",display=display.none)
plot(barstate.isnew,"New",display=display.none)
plot(67500+ticks/10,"Tick price",color=shade,linewidth=4)
plot(close,"Last price",color=shade,linewidth=4,style=plot.style_circles,show_last=1)`;
const historyStart = Date.parse("2026-09-15T00:30:00Z") / 1000;
const history = Array.from({ length: 600 }, (_, index) => ({ time: historyStart + index * 60, open: 67500 + index / 10 - 1, high: 67500 + index / 10 + 2, low: 67500 + index / 10 - 2, close: 67500 + index / 10, volume: 10 }));

// Decode only read-only numerical wire samples for an independent oracle. No
// prepared metadata, canonical runtime result, or engine state is injected.
async function productResults(page: Page, requestedSource = productSource) {
  return page.evaluate((source) => ((window as any).__layerResults ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    const result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    const plots = result.plots.map((plot: any) => {
      if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value), times: plot.points.map((point: any) => point.time) };
      const packed = plot.packed;
      const values = new Float64Array(response.buffers[packed.values]);
      const kinds = new Uint8Array(response.buffers[packed.kinds]);
      return { name: plot.name, values: Array.from({ length: packed.slots }, (_, index) => kinds[index] === 4 ? values[index] : kinds[index] === 2 ? false : kinds[index] === 3 ? true : null), slots: packed.slots };
    });
    return [{ sessionId: payload.sessionId, sequence: payload.sequence, declaration: result.declaration, audit: result.audit, source: result.source, inputs: result.inputs, plots }];
  }), requestedSource);
}
async function latestProduct(page: Page, predicate: (result: any) => boolean) {
  await expect.poll(async () => (await productResults(page)).some(predicate)).toBe(true);
  return (await productResults(page)).findLast(predicate)!;
}
async function coloredPixels(page: Page) {
  return page.locator(".chart-stage").first().evaluate((stage) => {
    const canvas = [...stage.querySelectorAll("canvas")].filter((item) => item.getBoundingClientRect().height > 80).sort((a, b) => b.width - a.width)[0];
    const bytes = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let blue = 0;
    for (let offset = 0; offset < bytes.length; offset += 4) {
      if (Math.abs(bytes[offset] - 255) <= 2 && bytes[offset + 1] <= 2 && bytes[offset + 2] <= 2) red++;
      if (bytes[offset] <= 2 && bytes[offset + 1] <= 2 && Math.abs(bytes[offset + 2] - 255) <= 2) blue++;
    }
    return { red, blue, width: canvas.width, height: canvas.height };
  });
}

test("real Live editor consumes Binance ticks close append and destroys changed input owners", async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sockets: any[] = [];
  const providerEvents: any[] = [];
  const layoutWrites: number[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("live-chart-layout.v1")) layoutWrites.push(Date.now());
  });
  await page.routeWebSocket(/data-stream\.binance\.vision/, (socket) => {
    sockets.push(socket);
    socket.onClose(() => { const index = sockets.indexOf(socket); if (index >= 0) sockets.splice(index, 1); });
  });
  const installProviderRoutes = async () => {
    await page.route("**/api/live/binance/instruments?**", route => route.fulfill({ json: { provider: "binance", instruments: ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, name: symbol, status: "TRADING", asset_class: "crypto", base_asset: symbol.slice(0, -4), quote_asset: "USDT", tick_size: 0.01, min_quantity: 0.00001, quantity_step: 0.00001 })), total: 2 } }));
    await page.route("https://data-api.binance.vision/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/klines")) {
      const rows = url.searchParams.has("endTime") ? [] : history.map((bar) => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), bar.time * 1000 + 59_999]);
      return route.fulfill({ json: rows });
    }
    if (url.pathname.endsWith("/ticker/24hr")) {
      return route.fulfill({ json: ["BTCUSDT", "ETHUSDT"].map((symbol) => ({ symbol, lastPrice: "67559.9", priceChange: "1", priceChangePercent: "0.1", highPrice: "67600", lowPrice: "67400", volume: "1000", quoteVolume: "67500000", openPrice: "67500", closeTime: Date.parse("2026-09-15T10:30:00Z") })) });
    }
    return route.fulfill({ json: { symbols: [{ symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" }, { symbol: "ETHUSDT", status: "TRADING", baseAsset: "ETH", quoteAsset: "USDT" }] } });
  });
  };
  const setup = await productSetup(page, { target: "/app/live", keepBinanceWebSocket: true, beforeNavigate: installProviderRoutes });
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  const minute = page.getByRole("button", { name: "1m", exact: true }).first();
  if (await minute.isVisible()) await minute.click();
  let dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(productSource);
  await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => setup.storage.get("custom-indicator-scripts.v1")?.some((item: any) => item.source === productSource)).toBe(true);
  const saved = structuredClone(setup.storage.get("custom-indicator-scripts.v1").find((item: any) => item.source === productSource));
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  const row = page.locator(".native-study-chip").filter({ hasText: productTitle }).first();
  await expect(row).toBeVisible();
  let eventTime = Date.parse("2026-09-15T10:30:00Z");
  const emit = (index: number, close: number, confirmed: boolean, duplicate = false) => {
    if (!duplicate) eventTime++;
    const bar = { time: historyStart + index * 60, open: 67560, high: Math.max(67562, close + 1), low: Math.min(67558, close - 1), close, volume: 15 };
    const payload = { stream: "btcusdt@kline_1m", data: { e: "kline", E: eventTime, s: "BTCUSDT", k: { t: bar.time * 1000, T: bar.time * 1000 + 59_999, i: "1m", s: "BTCUSDT", o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(bar.close), v: String(bar.volume), x: confirmed } } };
    providerEvents.push(payload);
    for (const socket of sockets) if (socket.url().includes("btcusdt@kline_1m")) socket.send(JSON.stringify(payload));
  };
  // Register before the first persistent constructor. Hold only an authentic
  // owned update so changing inputs can prove stale publication rejection.
  await page.evaluate(() => {
    const state = { target: null as string | null, held: null as MessageEvent | null };
    (window as any).__liveInputHold = state;
    addEventListener("message", (event) => {
      const payload = event.data?.payload;
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')]
        .find((item) => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (!frame || event.origin !== "null" || event.data?.type !== "result" || payload?.protocol !== "pine-live-v1"
        || payload.sessionId !== state.target || payload.sequence !== 6) return;
      state.held = event;
      event.stopImmediatePropagation();
    }, true);
  });
  emit(600, 67561, false);
  const initial = await latestProduct(page, (result) => result.sequence === 0);
  expect(initial.audit.mode).toBe("live");
  expect(plot(initial, "Ticks").values.at(-1)).toBe(600);
  expect(plot(initial, "History").values.every((value: any) => value === true)).toBe(true);
  const sessionId = initial.sessionId;
  expect(sessionId).toBeTruthy();
  const first = await latestProduct(page, (result) => result.sessionId === sessionId && result.sequence === 1);
  expect(plot(first, "Ordinary").values.at(-1)).toBe(601);
  expect(plot(first, "Ticks").values.at(-1)).toBe(601);
  emit(600, 67563, false);
  const tick = await latestProduct(page, (result) => result.sessionId === sessionId && result.sequence === 2);
  expect(plot(tick, "Ticks").values.at(-1)).toBe(602);
  expect(plot(tick, "Ordinary").values.at(-1)).toBe(601);
  const priorEma = plot(initial, "EMA").values.at(-1);
  expect(plot(tick, "EMA").values.at(-1)).toBe((priorEma + 67563) / 2);
  emit(600, 67563, false);
  const identical = await latestProduct(page, (result) => result.sessionId === sessionId && result.sequence === 3);
  expect(plot(identical, "Ticks").values.at(-1)).toBe(603);
  emit(600, 67563, true);
  const closed = await latestProduct(page, (result) => result.sessionId === sessionId && result.sequence === 4);
  expect(plot(closed, "Ticks").values.at(-1)).toBe(604);
  expect(plot(closed, "Confirmed").values.at(-1)).toBe(true);
  emit(601, 67564, false);
  const appended = await latestProduct(page, (result) => result.sessionId === sessionId && result.sequence === 5);
  expect(plot(appended, "Ticks").values.at(-1)).toBe(605);
  expect(plot(appended, "Ordinary").values.at(-1)).toBe(602);
  expect(plot(appended, "New").values.at(-1)).toBe(true);
  expect(appended.audit.bars).toBe(602);
  for (const result of [first, tick, identical, closed, appended]) {
    for (const name of ["Ticks", "Ordinary", "EMA"]) expect(plot(result, name).values.slice(0, 600)).toEqual(plot(initial, name).values);
  }
  await expect.poll(async () => (await coloredPixels(page)).red).toBeGreaterThan(0);
  await row.getByRole("button", { name: `Inputs for ${productTitle}`, exact: true }).click();
  await page.evaluate((id) => { (window as any).__liveInputHold.target = id; }, sessionId);
  emit(601, 67565, false);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__liveInputHold.held))).toBe(true);
  await row.getByRole("spinbutton", { name: "Increment", exact: true }).fill("2");
  const restarted = await latestProduct(page, (result) => result.sequence === 0 && result.sessionId !== sessionId && result.inputs.in_0 === 2);
  expect(plot(restarted, "Ticks").values.at(-1)).toBe(restarted.audit.bars * 2);
  const restartedOpen = await latestProduct(page, (result) => result.sessionId === restarted.sessionId && result.sequence === 1);
  const expectedPrice = 67500 + plot(restartedOpen, "Ticks").values.at(-1) / 10;
  const priceLabel = page.locator(".chart-study-pill").filter({ hasText: `${productTitle} · Tick price` }).locator("strong");
  await expect.poll(async () => Number((await priceLabel.textContent())!.replaceAll(",", ""))).toBe(expectedPrice);
  const staleDelivery = await page.evaluate(async () => {
    const state = (window as any).__liveInputHold;
    const genuine: MessageEvent = state.held;
    const stillConnected = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')]
      .some((frame) => frame.contentWindow === genuine.source);
    state.held = null;
    state.target = null;
    window.dispatchEvent(new MessageEvent("message", { data: genuine.data, source: genuine.source, origin: genuine.origin, ports: genuine.ports }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { stillConnected, sessionId: genuine.data.payload.sessionId, sequence: genuine.data.payload.sequence };
  });
  expect(staleDelivery).toEqual({ stillConnected: false, sessionId, sequence: 6 });
  expect(Number((await priceLabel.textContent())!.replaceAll(",", ""))).toBe(expectedPrice);
  await row.getByRole("textbox", { name: "Shade", exact: true }).fill("#0000ff");
  const blue = await latestProduct(page, (result) => result.sequence === 0 && result.inputs.in_1 === "#0000ff");
  await expect.poll(async () => (await coloredPixels(page)).blue).toBeGreaterThan(0);
  await row.getByRole("button", { name: `Close inputs for ${productTitle}`, exact: true }).click();
  const stage = page.locator(".chart-stage").first();
  await stage.scrollIntoViewIfNeeded();
  const folder = path.join(artifacts, info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, "live-ticks-inputs.png") });
  await page.getByRole("button", { name: "Layers", exact: true }).first().click();
  const objectRow = page.locator(".indicator-object-row").filter({ hasText: productTitle }).first();
  await expect(objectRow).toBeVisible();
  await objectRow.getByRole("button", { name: `On: Hide ${productTitle}`, exact: true }).click();
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  const beforeShow = (await productResults(page)).length;
  await objectRow.getByRole("button", { name: `Off: Show ${productTitle}`, exact: true }).click();
  await expect.poll(async () => (await productResults(page)).length).toBeGreaterThan(beforeShow);
  const shown = await latestProduct(page, (result) => result.sequence === 0 && result.sessionId !== blue.sessionId && result.inputs.in_1 === "#0000ff");
  expect(plot(shown, "Ticks").values.at(-1)).toBe(shown.audit.bars * 2);
  await objectRow.getByRole("button", { name: `Settings for ${productTitle}`, exact: true }).click();
  await objectRow.getByRole("button", { name: `Remove ${productTitle}`, exact: true }).click();
  await expect(objectRow).toHaveCount(0);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  const collapse = page.getByRole("button", { name: "Collapse chart objects", exact: true });
  if (await collapse.isVisible()) await collapse.click();
  const strategySource = `//@version=6
strategy("Closed live strategy",overlay=true)
plot(ta.ema(close,3),"Closed EMA",color=#00ff00)
plot(barstate.ishistory,"Closed history",display=display.none)
plot(barstate.isconfirmed,"Closed confirmed",display=display.none)
if bar_index==1
    strategy.entry("Long",strategy.long)
if bar_index==3
    strategy.close("Long")`;
  dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-strategy");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(strategySource);
  await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const beforeStrategyAdd = (await productResults(page, strategySource)).length;
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const strategyActivity: any[] = [];
  try {
    await expect.poll(async () => {
      const observation = await page.evaluate(() => ({
        frames: [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].map((frame) => ({
          session: /data-session="true"/.test(frame.srcdoc),
          job: frame.srcdoc.match(/data-job="([a-f0-9]+)"/)?.[1],
        })),
        responses: ((window as any).__layerResults ?? []).map((payload: any) => {
          const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
          return { id: response?.id, status: response?.status, kind: response?.result?.kind,
            declaration: response?.result?.declaration, sessionId: payload.sessionId, sequence: payload.sequence };
        }),
      }));
      strategyActivity.push({ ...observation, layoutWrites: layoutWrites.length });
      return observation.frames.length;
    }).toBe(1);
  } finally {
    save(info, "strategy-activity", { beforeStrategyAdd, strategyActivity, layoutWrites, workerFetchCount: setup.workerReceipts.length, errors });
  }
  await expect.poll(async () => (await productResults(page, strategySource)).length).toBeGreaterThan(beforeStrategyAdd);
  await expect(page.locator(".chart-study-pill").filter({ hasText: "Closed live strategy · Closed EMA" }).locator("strong")).toBeVisible();
  const closedStrategy = (await productResults(page, strategySource)).at(-1)!;
  expect(closedStrategy.declaration).toBe("strategy");
  expect(closedStrategy.sessionId).toBeTruthy();
  expect(plot(closedStrategy, "Closed history").values.every((value: any) => value === true)).toBe(true);
  expect(plot(closedStrategy, "Closed confirmed").values.every((value: any) => value === true)).toBe(true);
  expect(setup.storage.get("custom-indicator-scripts.v1").find((item: any) => item.id === saved.id)).toEqual(saved);
  expect(setup.workerReceipts.length).toBeGreaterThan(0);
  const workerName = fs.readdirSync(path.join(root, "frontend/dist/assets")).find((name) => /^pine-native-worker.*\.js$/.test(name))!;
  const workerBytes = fs.readFileSync(path.join(root, "frontend/dist/assets", workerName));
  const workerSha256 = createHash("sha256").update(workerBytes).digest("hex");
  expect(setup.workerReceipts.every((receipt) => receipt.sha256 === workerSha256 && receipt.bytes === workerBytes.length)).toBe(true);
  await page.goto("/account");
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  save(info, "live-product", { source: productSource, saved, initial, first, tick, identical, closed, appended, restarted, restartedOpen, staleDelivery, blue, shown, closedStrategy, strategyActivity, layoutWrites, providerEvents, workerName, workerBytes: workerBytes.length, workerSha256, workerReceipts: setup.workerReceipts, errors });
});
