import { test as base, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

type Outcome = { ok: boolean; value?: any; error?: { code?: string; name: string; message: string } };
type Harness = { origin: string; endpointRequests: string[]; assetRequests: string[]; workerPath: string };
type FixtureAPI = {
  startRuntime(request: any): string;
  startObservedRuntime(request: any, holdCompletion?: boolean): string;
  packedSummary(id: string): Promise<any>;
  bridgeOwnership(id: string): any;
  startPackedForgery(id: string, mutation: string): string;
  startProbe(options: { source: string; request?: Record<string, unknown>; timeoutMs?: number; validateAsPine?: any }): string;
  startObservedProbe(options: { source: string; timeoutMs?: number }): string;
  terminationAcks(id: string): number;
  bridgeReady(id: string): boolean;
  result(id: string): Promise<Outcome>;
  settled(id: string): boolean;
  cancel(id: string): void;
};
declare global { interface Window { pineFixture: FixtureAPI; pineHeartbeat?: number; pineInjected?: boolean; } }

const root = path.resolve(import.meta.dirname, "..");
const bars = Array.from({ length: 40 }, (_, index) => {
  const close = 10 + index * 0.4 + Math.sin(index) * 0.7;
  return { time: 1_700_000_000 + index * 60, open: close - 0.2, high: close + 0.4, low: close - 0.5, close, volume: 100 + index };
});
const indicator = (version: 5 | 6) => `//@version=${version}\nindicator("Native", overlay=true)\nlen=input.int(3,"Length")\nplot(ta.ema(close,len),"EMA",color=color.blue)\nplot(ta.rsi(close,len),"RSI")`;
const runtimeRequest = (source = indicator(6)) => ({ action: "run", source, bars, context: { symbol: "TEST", timeframe: "1" }, inputs: {}, mode: "historical" });

const entry = `
import { createPineRuntimeJob } from './pineRuntime';
import { createSandboxWorkerJob, PineSandboxError } from './pineSandbox';
import { validatePineRequest, validatePineResponse } from './pineProtocol';
import { getPackedPinePlot, pointAtBar } from './pinePacked';
const jobs = new Map();
const acknowledgments = new Map();
const readiness = new Map();
const packedObservations = new Map();
const ownership = new Map();
const observedRequests = new Map();
function register(job) {
  const state = { job, settled: false, promise: null };
  state.promise = job.promise.then(value => ({ok:true,value}), error => ({ok:false,error:{name:error.name,code:error.code,message:error.message}})).then(value => {state.settled = true; return value;});
  jobs.set(job.id,state); return job.id;
}
export function startRuntime(request) { return register(createPineRuntimeJob(request)); }
export function startObservedRuntime(request, holdCompletion=false) {
  let job, target, nonce, heldResult;
  const observe = event => {
    if (event.source !== target || event.origin !== 'null' || event.data?.nonce !== nonce) return;
    if (event.data.type === 'result') {
      packedObservations.set(job.id,event.data.payload);
      if (holdCompletion && event.data.payload?.encoding === 'pine-packed-v1') { heldResult=event; event.stopImmediatePropagation(); }
    }
    if (event.data.type === 'fixture-transfer-ownership') {
      ownership.set(job.id,event.data.payload);
      if (heldResult) {
        const genuine=heldResult, proof=event.data.payload;
        const sizes=genuine.data.payload.buffers.map(buffer=>buffer.byteLength);
        if (!Array.isArray(proof.before) || !Array.isArray(proof.after) || proof.before.length!==sizes.length || proof.after.length!==sizes.length || !proof.before.every((size,index)=>size===sizes[index]) || !proof.after.every(size=>size===0)) throw new Error('Fixture did not prove genuine transfer ownership.');
        heldResult=undefined; holdCompletion=false;
        // Native stopImmediatePropagation flags persist on the captured event.
        // Replay its exact authenticated fields and original payload references;
        // the real Worker and production bridge have already transferred buffers.
        const replay=new MessageEvent(genuine.type,{data:genuine.data,source:genuine.source,origin:genuine.origin,lastEventId:genuine.lastEventId,ports:genuine.ports});
        if (replay.data!==genuine.data || replay.source!==genuine.source || replay.origin!==genuine.origin) throw new Error('Fixture changed an authenticated message field.');
        window.dispatchEvent(replay);
      }
    }
  };
  // Keep only the observed genuine result pending until its frame proves detach.
  // Preserve its authenticated data/source/origin without weakening any check.
  window.addEventListener('message',observe,true);
  job = createPineRuntimeJob(request);
  const frame = document.querySelector('iframe[sandbox="allow-scripts"]');
  target = frame.contentWindow; nonce = frame.srcdoc.match(/data-job="([a-f0-9]+)"/)[1];
  const id = register(job);
  observedRequests.set(id,request);
  // The ownership proof is posted after the result from the same frame.
  void result(id).finally(() => setTimeout(() => window.removeEventListener('message',observe,true),100));
  return id;
}
export function bridgeOwnership(id) { return ownership.get(id) ?? null; }
export function startPackedForgery(id,mutation) {
  const wire = structuredClone(packedObservations.get(id));
  return startProbe({request:{wire,mutation},validateAsPine:observedRequests.get(id),source:\`onmessage=event=>{
    const wire=event.data.wire,plot=wire.result.plots[0]; wire.id=event.data.id;
    if(event.data.mutation==='buffers-extra') wire.buffers.extra='unsafe';
    if(event.data.mutation==='kind') new Uint8Array(wire.buffers[plot.packed.kinds])[0]=255;
    if(event.data.mutation==='number') new Float64Array(wire.buffers[plot.packed.values])[0]=Infinity;
    if(event.data.mutation==='option') new Uint16Array(wire.buffers[plot.packed.optionIndices])[0]=65535;
    if(event.data.mutation==='fill') {plot.style='fill';plot.options={plot1:'missing',plot2:wire.result.plots[1].id};}
    if(event.data.mutation==='metadata') plot.packed.optionTable=Array.from({length:64},()=>({text:'x'.repeat(4096),textcolor:'x'.repeat(4096),style:'x'.repeat(4096),location:'x'.repeat(4096)}));
    const numeric=wire.result.plots.find(output=>output.packed.numericOptions?.length)?.packed;
    if(event.data.mutation==='numeric-state') new Uint8Array(wire.buffers[numeric.kinds])[numeric.slots]=2;
    if(event.data.mutation==='numeric-number') new Float64Array(wire.buffers[numeric.values])[numeric.slots*numeric.arity]=Infinity;
    if(event.data.mutation==='numeric-key') numeric.numericOptions[0]='__proto__';
    if(event.data.mutation==='numeric-length') wire.buffers[numeric.values]=wire.buffers[numeric.values].slice(0,-8);
    postMessage(wire,wire.buffers);
  }\`});
}

export async function packedSummary(id) {
  const outcome = await result(id);
  if (!outcome.ok) return outcome;
  const value = outcome.value, wire = packedObservations.get(id);
  return {ok:true,source:value.source,audit:value.audit,encoding:wire?.encoding,buffers:wire?.buffers?.length,metadataBytes:wire ? new TextEncoder().encode(JSON.stringify({...wire,buffers:[]})).length : undefined,bufferBytes:wire?.buffers?.reduce((sum,buffer)=>sum+buffer.byteLength,0),plots:value.plots.map(plot=>{
    const packed = getPackedPinePlot(plot);
    return {id:plot.id,packed:Boolean(packed),slots:packed?.kinds.length,first:pointAtBar(plot,0),last:pointAtBar(plot,value.audit.bars-1),ownsReceivedBuffers:packed ? [packed.values.buffer,packed.kinds.buffer,packed.optionIndices.buffer].every(buffer=>wire.buffers.includes(buffer)) : false};
  })};
}
export function startProbe(options) {
  const id = 'probe-' + crypto.randomUUID();
  const binding = options.validateAsPine ? validatePineRequest({...options.validateAsPine,id}) : null;
  return register(createSandboxWorkerJob({
    request:{id,...options.request}, timeoutMs:options.timeoutMs ?? 3000,
    loadWorker:async () => options.source,
    validate(value) {
      if (binding) return validatePineResponse(value,binding);
      if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 10000) throw new PineSandboxError('INVALID_RESULT','Untrusted worker result rejected.');
      return value;
    },
  }));
}
export function result(id) { return jobs.get(id).promise; }
export function settled(id) { return jobs.get(id).settled; }
export function cancel(id) { jobs.get(id).job.cancel(); }
export function startObservedProbe(options) {
  let target, nonce, id;
  const observe = event => {
    if (event.source !== target || event.origin !== 'null' || event.data?.nonce !== nonce) return;
    if (event.data.type === 'stopped') acknowledgments.set(id,acknowledgments.get(id)+1);
    if (event.data.type === 'ready') readiness.set(id,true);
  };
  window.addEventListener('message',observe);
  id = startProbe(options);
  const frame = document.querySelector('iframe[sandbox="allow-scripts"]');
  target = frame.contentWindow; nonce = frame.srcdoc.match(/data-job="([a-f0-9]+)"/)[1];
  acknowledgments.set(id,0);
  void result(id).finally(() => window.removeEventListener('message',observe));
  return id;
}
export function terminationAcks(id) { return acknowledgments.get(id) ?? 0; }
export function bridgeReady(id) { return readiness.get(id) === true; }
`;

const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const assets = path.join(root, "frontend/dist/assets");
    const workerName = fs.readdirSync(assets).find((name) => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Build the production Pine worker before running native tests.");
    const workerPath = `/assets/${workerName}`;
    const bundled = await build({
      stdin: { contents: entry, resolveDir: path.join(root, "frontend/src/lib"), sourcefile: "pine-native-fixture.ts", loader: "ts" },
      bundle: true, write: false, platform: "browser", format: "iife", globalName: "pineFixture",
      plugins: [{ name: "production-pine-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "production-worker", namespace: "pine-fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "pine-fixture" }, () => ({ contents: `export default ${JSON.stringify(workerPath)}`, loader: "js" }));
      } }],
    });
    const endpointRequests: string[] = [], assetRequests: string[] = [];
    const worker = fs.readFileSync(path.join(assets, workerName));
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><title>Pine native isolation fixture</title><main id="parent-secret">Parent workspace secret</main><script src="/fixture.js"></script>'); }
      else if (pathname === "/favicon.ico") { response.statusCode = 204; response.end(); }
      else if (pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0].contents); }
      else if (pathname === workerPath) { assetRequests.push(pathname); response.setHeader("Content-Type", "text/javascript"); response.end(worker); }
      else { endpointRequests.push(pathname); response.setHeader("Content-Type", "text/javascript"); response.end('globalThis.networkProbeLoaded=true; export default 1;'); }
    });
    server.on("upgrade", (request, socket) => { endpointRequests.push(new URL(request.url ?? "/", "http://127.0.0.1").pathname); socket.destroy(); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Native fixture server did not bind.");
    try { await use({ origin: `http://127.0.0.1:${address.port}`, endpointRequests, assetRequests, workerPath }); }
    finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => {
    serverHarness.endpointRequests.length = 0; serverHarness.assetRequests.length = 0;
    await page.goto(serverHarness.origin);
    await page.evaluate(() => { localStorage.setItem("workspace-secret", "private-value"); document.cookie = "workspace_secret=private-cookie; SameSite=Strict"; });
    await use(serverHarness);
  },
});

async function run(page: Page, request = runtimeRequest()) {
  return page.evaluate(async (input) => { const id = window.pineFixture.startRuntime(input); return window.pineFixture.result(id); }, request);
}
async function probe(page: Page, source: string, options: { request?: Record<string, unknown>; timeoutMs?: number; validateAsPine?: any } = {}) {
  return page.evaluate(async (input) => { const id = window.pineFixture.startProbe(input); return window.pineFixture.result(id); }, { source, ...options });
}

for (const version of [5, 6] as const) test(`production Pine v${version} computes native EMA and RSI in the opaque worker`, async ({ page, harness }) => {
  const prepared = await run(page, { ...runtimeRequest(indicator(version)), action: "prepare" });
  expect(prepared.ok, JSON.stringify(prepared.error)).toBe(true);
  expect(prepared.value).toMatchObject({ kind: "prepare", language: "pine", pineVersion: version, declaration: "indicator", name: "Native", overlay: true });
  expect(prepared.value.inputDefinitions).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Length", type: "int", defval: 3 })]));
  const output = await run(page, runtimeRequest(indicator(version)));
  expect(output.ok, JSON.stringify(output.error)).toBe(true);
  expect(output.value).toMatchObject({ kind: "run", pineVersion: version, audit: { engine: "PineTS", engineVersion: "0.11.0", bars: bars.length, mode: "historical" } });
  const ema = output.value.plots.find((plot: any) => plot.name === "EMA");
  const rsi = output.value.plots.find((plot: any) => plot.name === "RSI");
  expect(ema.points).toHaveLength(bars.length);
  expect(ema.points.at(-1).time).toBe(bars.at(-1)!.time);
  let expected = bars[0].close;
  for (const bar of bars.slice(1)) expected = bar.close * 0.5 + expected * 0.5;
  expect(ema.points.at(-1).value).toBeCloseTo(expected, 8);
  expect(rsi.points.slice(10).every((point: any) => typeof point.value === "number" && point.value >= 0 && point.value <= 100)).toBe(true);
  const changes = bars.slice(1).map((bar, index) => bar.close - bars[index].close);
  let gains = changes.slice(0, 3).reduce((sum, change) => sum + Math.max(change, 0), 0) / 3;
  let losses = changes.slice(0, 3).reduce((sum, change) => sum + Math.max(-change, 0), 0) / 3;
  for (const change of changes.slice(3)) { gains = (gains * 2 + Math.max(change, 0)) / 3; losses = (losses * 2 + Math.max(-change, 0)) / 3; }
  expect(rsi.points.at(-1).value).toBeCloseTo(losses === 0 ? 100 : 100 - 100 / (1 + gains / losses), 8);
  expect(harness.assetRequests.length).toBeGreaterThan(0);
  expect(harness.endpointRequests).toEqual([]);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
});

test("production Pine strategy executes entries and closes without parent access", async ({ page, harness }) => {
  const source = '//@version=6\nstrategy("Native strategy", initial_capital=1000)\nif bar_index == 1\n    strategy.entry("L", strategy.long, qty=2)\nif bar_index == 3\n    strategy.close("L")';
  const output = await run(page, runtimeRequest(source));
  expect(output.ok, JSON.stringify(output.error)).toBe(true);
  expect(output.value).toMatchObject({ kind: "run", declaration: "strategy", name: "Native strategy" });
  expect(output.value.strategy.closedTrades).toHaveLength(1);
  expect(output.value.strategy.openTrades).toHaveLength(0);
  expect(harness.endpointRequests).toEqual([]);
  await expect(page.locator("#parent-secret")).toHaveText("Parent workspace secret");
});

test("opaque worker CSP blocks every network primitive and keeps workspace storage unavailable", async ({ page, harness }) => {
  const source = `onmessage=async event=>{
    const base=event.data.base, checks={};
    async function attempt(name,call){try{await call();checks[name]=false;}catch{checks[name]=true;}}
    await attempt('fetch',()=>fetch(base+'/probe/fetch',{credentials:'include'}));
    await attempt('xhr',()=>new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.onload=resolve;x.onerror=reject;x.open('GET',base+'/probe/xhr');x.send();}));
    await attempt('socket',()=>new Promise((resolve,reject)=>{const w=new WebSocket(base.replace('http:','ws:')+'/probe/socket');w.onopen=()=>{w.close();resolve();};w.onerror=reject;}));
    await attempt('importScripts',()=>importScripts(base+'/probe/importscripts.js'));
    await attempt('dynamicImport',()=>import(base+'/probe/dynamic.js'));
    await attempt('dataFetch',()=>fetch('data:text/plain,secret'));
    checks.document=typeof document;checks.parent=typeof parent;checks.storage=typeof localStorage;checks.cookie=typeof document==='undefined'?'unavailable':document.cookie;checks.origin=location.origin;
    postMessage(checks);
  }`;
  const output = await probe(page, source, { request: { base: harness.origin } });
  expect(output).toMatchObject({ ok: true, value: { fetch: true, xhr: true, socket: true, importScripts: true, dynamicImport: true, dataFetch: true, document: "undefined", parent: "undefined", storage: "undefined", cookie: "unavailable", origin: "null" } });
  expect(harness.endpointRequests).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("workspace-secret"))).toBe("private-value");
  expect(await page.evaluate(() => document.cookie)).toContain("workspace_secret=private-cookie");
});

test("a different opaque frame cannot spoof completion even with the copied bridge nonce", async ({ page, harness }) => {
  const id = await page.evaluate(() => window.pineFixture.startProbe({ source: 'onmessage=()=>setTimeout(()=>postMessage({legitimate:true}),500)' }));
  const frame = page.locator('iframe[sandbox="allow-scripts"]');
  const html = await frame.getAttribute("srcdoc");
  const nonce = html!.match(/data-job="([a-f0-9]+)"/)![1];
  await page.evaluate(async (copied) => {
    const attacker = document.createElement("iframe"); attacker.setAttribute("sandbox", "allow-scripts");
    attacker.srcdoc = `<script>parent.postMessage({nonce:${JSON.stringify(copied)},type:'result',payload:{spoof:true}},'*')<\/script>`;
    document.body.append(attacker); await new Promise<void>((resolve) => { attacker.onload = () => setTimeout(resolve, 30); }); attacker.remove();
  }, nonce);
  expect(await page.evaluate((job) => window.pineFixture.settled(job), id)).toBe(false);
  expect(await page.evaluate((job) => window.pineFixture.result(job), id)).toEqual({ ok: true, value: { legitimate: true } });
  expect(harness.endpointRequests).toEqual([]);
});

test("HTML-shaped source remains message data and never enters the bridge document", async ({ page, harness }) => {
  const payload = '</script><script>parent.pineInjected=true</script><img src="/probe/html">';
  const id = await page.evaluate((text) => window.pineFixture.startProbe({ source: 'onmessage=e=>setTimeout(()=>postMessage({echo:e.data.source}),100)', request: { source: text } }), payload);
  const frame = page.locator('iframe[sandbox="allow-scripts"]');
  expect(await frame.getAttribute("srcdoc")).not.toContain(payload);
  const blocked = await frame.evaluate((element) => {
    try { return { parentAccess: Boolean((element as HTMLIFrameElement).contentWindow!.document) }; }
    catch (error) { return { parentAccess: false, error: (error as Error).name }; }
  });
  expect(blocked).toEqual({ parentAccess: false, error: "SecurityError" });
  expect(await page.evaluate((job) => window.pineFixture.result(job), id)).toEqual({ ok: true, value: { echo: payload } });
  const executed = await run(page, runtimeRequest(`//@version=6\nindicator(${JSON.stringify(payload)})\nplot(close,"Price")`));
  expect(executed.ok, JSON.stringify(executed.error)).toBe(true);
  expect(executed.value.name).toBe(payload);
  expect(await page.evaluate(() => window.pineInjected)).toBeUndefined();
  expect(harness.endpointRequests).toEqual([]);
});

test("malformed and oversized messages are rejected by the production response validator", async ({ page, harness }) => {
  for (const source of ['onmessage=()=>postMessage(null)', 'onmessage=()=>postMessage({id:"wrong",kind:"run"})', 'onmessage=()=>postMessage({payload:"x".repeat(2000000)})']) {
    const output = await probe(page, source, { validateAsPine: runtimeRequest() });
    expect(output.ok).toBe(false);
    expect(output.error!.message).toBeTruthy();
    await expect(page.locator("iframe")).toHaveCount(0);
  }
  expect(harness.endpointRequests).toEqual([]);
});

test("timeouts and cancellation terminate infinite workers while the parent stays responsive and the next Pine job succeeds", async ({ page, harness }) => {
  await page.evaluate(() => { window.pineHeartbeat = 0; setInterval(() => { window.pineHeartbeat! += 1; }, 5); });
  const timedId = await page.evaluate(() => window.pineFixture.startObservedProbe({ source: 'onmessage=()=>{while(true){}}', timeoutMs: 400 }));
  const timedOut = await page.evaluate((job) => window.pineFixture.result(job), timedId);
  expect(timedOut).toMatchObject({ ok: false, error: { code: "TIME_LIMIT" } });
  expect(await page.evaluate((job) => window.pineFixture.terminationAcks(job), timedId)).toBe(1);
  expect(await page.evaluate(() => window.pineHeartbeat)).toBeGreaterThan(5);
  const id = await page.evaluate(() => window.pineFixture.startObservedProbe({ source: 'onmessage=()=>{while(true){}}' }));
  await expect.poll(() => page.evaluate((job) => window.pineFixture.bridgeReady(job), id)).toBe(true);
  await page.waitForTimeout(50);
  await page.evaluate((job) => window.pineFixture.cancel(job), id);
  expect(await page.evaluate((job) => window.pineFixture.result(job), id)).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
  expect(await page.evaluate((job) => window.pineFixture.terminationAcks(job), id)).toBe(1);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect((await run(page)).ok).toBe(true);
  expect(harness.endpointRequests).toEqual([]);
});


test("production worker treats past and future snapshots as closed historical bars in both modes", async ({ page, harness }) => {
  test.setTimeout(60_000);
  const states = ["ishistory", "isrealtime", "isconfirmed", "isnew", "isfirst", "islast", "islastconfirmedhistory"];
  for (const version of [5, 6]) for (const mode of ["historical", "live"]) for (const count of [1, 4]) for (const start of [946_684_800, 4_102_444_800]) {
    const snapshot = bars.slice(0, count).map((bar, index) => ({ ...bar, time: start + index * 60 }));
    const source = `//@version=${version}\nindicator("Closed states")\n` + states.map((state) => `plot(barstate.${state} ? 1 : 0,"${state}")`).join("\n");
    const output = await run(page, { ...runtimeRequest(source), bars: snapshot, mode });
    expect(output.ok, `${version} ${mode} ${count} ${start}: ${JSON.stringify(output.error)}`).toBe(true);
    expect(output.value.source).toBe(source);
    expect(output.value).toMatchObject({ pineVersion: version, audit: { bars: count, mode, engine: "PineTS", engineVersion: "0.11.0" } });
    const ones = Array(count).fill(1), zeros = Array(count).fill(0);
    expect(Object.fromEntries(output.value.plots.map((plot: any) => [plot.name, plot.points.map((point: any) => point.value)]))).toEqual({
      ishistory: ones, isrealtime: zeros, isconfirmed: ones, isnew: ones,
      isfirst: ones.map((_, index) => index === 0 ? 1 : 0), islast: ones.map((_, index) => index === count - 1 ? 1 : 0),
      islastconfirmedhistory: ones.map((_, index) => index === count - 1 ? 1 : 0),
    });
    for (const plot of output.value.plots) expect(plot.points.map((point: any) => point.time)).toEqual(snapshot.map((bar) => bar.time));
    expect(output.value.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CLOSED_BAR_SNAPSHOT", severity: "warning" })]));
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  }
  expect(harness.endpointRequests).toEqual([]);
});

test("production worker guards resolved strategy flags before orders and keeps false-alias next-open fills", async ({ page, harness }) => {
  test.setTimeout(60_000);
  const flags = ["calc_on_every_tick", "calc_on_order_fills", "calc_on_every_history_tick"];
  const snapshot = Array.from({ length: 6 }, (_, index) => ({ time: 1_700_000_040 + index * 60, open: index + 1, high: index + 2, low: index, close: index + 1, volume: 10 }));
  const aliases = [
    { prefix: "const bool enabled = true", inputs: {} },
    { prefix: 'enabled = input.bool(false,"Recalculate")', inputs: { in_0: true } },
  ];
  for (const version of [5, 6]) for (const flag of flags) for (const alias of aliases) {
    const source = `//@version=${version}\n${alias.prefix}\nstrategy("Resolved flag",${flag}=enabled)\nstrategy.entry("L",strategy.long)\nplot(not_a_real_function(close))`;
    const output = await run(page, { ...runtimeRequest(source), bars: snapshot, inputs: alias.inputs });
    expect(output).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_EXECUTION_SETTING" } });
    expect(output.error!.message).toContain(flag);
    expect(output.value).toBeUndefined();
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  }
  for (const version of [5, 6]) for (const alias of [
    { prefix: "const bool disabled = false", inputs: {} },
    { prefix: 'disabled = input.bool(true,"Recalculate")', inputs: { in_0: false } },
  ]) {
    const source = `//@version=${version}\n${alias.prefix}\nstrategy("False alias ledger",initial_capital=1000,${flags.map((flag) => `${flag}=disabled`).join(",")})\nif barstate.ishistory and barstate.isconfirmed and bar_index == 1\n    strategy.entry("L",strategy.long,qty=2)\nif bar_index == 3\n    strategy.close("L")`;
    const output = await run(page, { ...runtimeRequest(source), bars: snapshot, inputs: alias.inputs });
    expect(output.ok, JSON.stringify(output.error)).toBe(true);
    expect(output.value.source).toBe(source);
    for (const flag of flags) expect(output.value.strategy.config[flag]).toBe(false);
    expect(output.value.strategy.closedTrades).toHaveLength(1);
    expect(output.value.strategy.closedTrades[0]).toMatchObject({ entry_bar_index: 2, exit_bar_index: 4, entry_time: snapshot[2].time, exit_time: snapshot[4].time, entry_price: 3, exit_price: 5, profit: 4 });
    expect(output.value.strategy.metrics.netprofit).toBe(4);
    expect(output.value.strategy.openTrades).toEqual([]);
    expect(output.value.strategy.pendingOrders).toEqual([]);
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  }
  expect(harness.endpointRequests).toEqual([]);
  await expect(page.locator("#parent-secret")).toHaveText("Parent workspace secret");
  expect(await page.evaluate(() => localStorage.getItem("workspace-secret"))).toBe("private-value");
});


test("production opaque bridge transfers packed buffers and preserves receiver ownership", async ({ page, harness }) => {
  const snapshot = Array.from({ length: 600 }, (_, index) => ({ time: 1_700_000_040 + index * 60, open: index + 1, high: index + 2, low: index, close: index + 1, volume: 10 }));
  const source = `//@version=6\nindicator("Packed bridge")\n${Array.from({ length: 8 }, (_, index) => `plot(close+${index},"Channel ${index}")`).join("\n")}`;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`${harness.origin}${harness.workerPath}`, async (route) => { await held; await route.continue(); });
  const id = await page.evaluate((input) => window.pineFixture.startObservedRuntime(input, true), { ...runtimeRequest(source), bars: snapshot });
  const frame = page.locator('iframe[sandbox="allow-scripts"]');
  const nonce = (await frame.getAttribute("srcdoc"))!.match(/data-job="([a-f0-9]+)"/)![1];
  // Observe native Worker events inside the genuine opaque frame. The subclass
  // delegates all work to the browser's real Worker; bridge code stays unchanged.
  await frame.contentFrame().locator("html").evaluate((_, binding) => {
    const NativeWorker = Worker;
    class ObservedWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (event.data?.encoding !== "pine-packed-v1") return;
          const buffers: ArrayBuffer[] = event.data.buffers;
          const before = buffers.map((buffer) => buffer.byteLength);
          // The genuine result is held in the parent, so this frame survives
          // until the next task observes the bridge's synchronous transfer.
          setTimeout(() => parent.postMessage({ nonce: binding, type: "fixture-transfer-ownership", payload: { before, after: buffers.map((buffer) => buffer.byteLength) } }, "*"), 0);
        });
      }
    }
    Object.defineProperty(window, "Worker", { value: ObservedWorker, configurable: true, writable: true });
  }, nonce);
  release();
  const summary = await page.evaluate((job) => window.pineFixture.packedSummary(job), id);
  expect(summary.ok, JSON.stringify(summary.error)).toBe(true);
  expect(summary).toMatchObject({ encoding: "pine-packed-v1", buffers: 24, bufferBytes: 52_800, audit: { bars: 600, engine: "PineTS", engineVersion: "0.11.0" } });
  expect(summary.plots).toHaveLength(8);
  for (const [index, plot] of summary.plots.entries()) {
    expect(plot).toMatchObject({ packed: true, slots: 600, ownsReceivedBuffers: true, first: { time: snapshot[0].time, value: 1 + index }, last: { time: snapshot[599].time, value: 600 + index } });
  }
  await expect.poll(() => page.evaluate((job) => window.pineFixture.bridgeOwnership(job), id)).toEqual({ before: Array.from({ length: 8 }, () => [4800, 600, 1200]).flat(), after: Array(24).fill(0) });
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  expect(harness.endpointRequests).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("workspace-secret"))).toBe("private-value");
});

test("production opaque worker completes the 64-by-20,000 scalar boundary without parent point inflation", async ({ page, harness }) => {
  test.setTimeout(60_000);
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ time: 1_700_000_040 + index * 60, open: index + 1, high: index + 2, low: index, close: index + 1, volume: 10 }));
  const source = `//@version=6\nindicator("Full packed capacity")\n${Array.from({ length: 64 }, (_, index) => `plot(close+${index},"Channel ${index}")`).join("\n")}`;
  const id = await page.evaluate((input) => window.pineFixture.startObservedRuntime(input), { ...runtimeRequest(source), bars: snapshot });
  const summary = await page.evaluate((job) => window.pineFixture.packedSummary(job), id);
  expect(summary.ok, JSON.stringify(summary.error)).toBe(true);
  expect(summary).toMatchObject({ source, encoding: "pine-packed-v1", buffers: 192, bufferBytes: 14_080_000, audit: { bars: 20_000 } });
  expect(summary.plots).toHaveLength(64);
  for (const [index, plot] of summary.plots.entries()) expect(plot).toMatchObject({ packed: true, slots: 20_000, ownsReceivedBuffers: true, first: { time: snapshot[0].time, value: 1 + index }, last: { time: snapshot[19_999].time, value: 20_000 + index } });
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  const tooMany = source + '\nplot(close,"Channel64")';
  expect(await run(page, { ...runtimeRequest(tooMany), bars: snapshot.slice(0, 2) })).toMatchObject({ ok: false, error: { code: "PLOT_LIMIT" } });
  expect(harness.endpointRequests).toEqual([]);
});


test("production opaque bridge retains continuously changing 20k gradient anchors", async ({ page, harness }) => {
  test.setTimeout(60_000);
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 }));
  const source = '//@version=6\nindicator("Continuous gradient")\na=plot(110,"Mask A",display=display.none)\nb=plot(90,"Mask B",display=display.none)\nfill(a,b,120+bar_index*.01,80-bar_index*.01,#ff0000,#0000ff)';
  const id = await page.evaluate((input) => window.pineFixture.startObservedRuntime(input), { ...runtimeRequest(source), bars: snapshot });
  const summary = await page.evaluate((job) => window.pineFixture.packedSummary(job), id);
  expect(summary.ok, JSON.stringify(summary.error)).toBe(true);
  expect(summary).toMatchObject({ source, encoding: "pine-packed-v1", audit: { bars: 20_000 } });
  expect(summary.metadataBytes).toBeLessThan(10_000);
  expect(summary.bufferBytes).toBeLessThan(1_100_000);
  expect(summary.plots).toHaveLength(3);
  for (const plot of summary.plots) expect(plot).toMatchObject({ packed: true, slots: 20_000, ownsReceivedBuffers: true });
  expect(summary.plots[2]).toMatchObject({ first: { time: snapshot[0].time, value: null, options: { top_value: 120, bottom_value: 80 } }, last: { time: snapshot[19_999].time, value: null, options: { top_value: 120 + 19_999 * .01, bottom_value: 80 - 19_999 * .01 } } });
  for (const mutation of ["numeric-state", "numeric-number", "numeric-key", "numeric-length"]) {
    const forged = await page.evaluate((input) => window.pineFixture.startPackedForgery(input.id, input.mutation), { id, mutation });
    const rejected = await page.evaluate((job) => window.pineFixture.result(job), forged);
    expect(rejected, mutation).toMatchObject({ ok: false, error: { code: "INVALID_MESSAGE" } });
    expect(rejected.value).toBeUndefined();
  }
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  expect(harness.endpointRequests).toEqual([]);
});

test("opaque bridge rejects forged packed cells, option indices, fill references and metadata overflow", async ({ page, harness }) => {
  const snapshot = Array.from({ length: 600 }, (_, index) => ({ time: 1_700_000_040 + index * 60, open: index + 1, high: index + 2, low: index, close: index + 1, volume: 10 }));
  const source = `//@version=6\nindicator("Packed validation")\n${Array.from({ length: 8 }, (_, index) => `plot(close+${index},"Channel ${index}")`).join("\n")}`;
  const original = await page.evaluate((input) => window.pineFixture.startObservedRuntime(input), { ...runtimeRequest(source), bars: snapshot });
  expect((await page.evaluate((id) => window.pineFixture.packedSummary(id), original)).ok).toBe(true);
  for (const mutation of ["kind", "number", "option", "fill", "metadata", "buffers-extra"]) {
    const id = await page.evaluate((input) => window.pineFixture.startPackedForgery(input.id, input.mutation), { id: original, mutation });
    const rejected = await page.evaluate((job) => window.pineFixture.result(job), id);
    expect(rejected, mutation).toMatchObject({ ok: false, error: { code: "INVALID_MESSAGE" } });
    if (mutation === "metadata" || mutation === "buffers-extra") expect(rejected.error!.message).toContain("invalid packed transport");
    expect(rejected.value).toBeUndefined();
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  }
  expect((await run(page)).ok).toBe(true);
  expect(harness.endpointRequests).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("workspace-secret"))).toBe("private-value");
});
