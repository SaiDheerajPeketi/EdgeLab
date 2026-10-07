import { test as base, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

type Outcome = { ok: boolean; value?: any; error?: { code?: string; name: string; message: string } };
type Harness = { origin: string; endpointRequests: string[]; assetRequests: string[]; workerPath: string };
type FixtureAPI = {
  startRuntime(request: any): string;
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
const jobs = new Map();
const acknowledgments = new Map();
const readiness = new Map();
function register(job) {
  const state = { job, settled: false, promise: null };
  state.promise = job.promise.then(value => ({ok:true,value}), error => ({ok:false,error:{name:error.name,code:error.code,message:error.message}})).then(value => {state.settled = true; return value;});
  jobs.set(job.id,state); return job.id;
}
export function startRuntime(request) { return register(createPineRuntimeJob(request)); }
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
