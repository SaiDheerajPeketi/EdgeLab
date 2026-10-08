import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

import { cases69, context69, bars69, ledger69, info69 } from "../backend/tests/fixtures/pine-instrument69.mjs";
const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, ".artifacts/pine-instrument69/browser");
const port = Number(process.env.EDGELAB_PINE_INSTRUMENT69_PORT ?? 45369);
let server: http.Server;
let origin: string;
let workerPath: string;
let workerBytes: Buffer;
let workerRequests: string[];
let unexpectedRequests: string[];

// Same real-runtime transport as pine-runtime: the host bundles only the public
// job API; the opaque bridge receives byte-identical frozen production worker JS.
test.beforeAll(async () => {
  const assets = path.join(root, "frontend/dist/assets");
  const name = fs.readdirSync(assets).find((entry) => /^pine-native-worker.*\.js$/.test(entry));
  if (!name) throw new Error("Build the production worker before this isolated gate.");
  workerPath = `/assets/${name}`;
  workerBytes = fs.readFileSync(path.join(assets, name));
  const fixture = await build({
    stdin: {
      contents: `import {createPineRuntimeJob} from './pineRuntime';
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {usePineInstrumentContext} from '../components/chart/usePineInstrumentContext';
import {createPineLiveFeed} from './pineLiveFeed';
import {setStoredAuthSession} from './authSession';
export function mountMetadata() {
 const feed=createPineLiveFeed('TESTUSDT');
 const account=id=>setStoredAuthSession({createdAt:new Date().toISOString(),expiresAt:'2099-01-01T00:00:00Z',token:'fixture-'+id,user:{id,email:'fixture'+id+'@example.test',name:'Fixture',provider:'email',approved:true,betaPosition:1,deploymentMode:'beta',workspaceAccess:true,accessExpiresAt:'2099-01-01T00:00:00Z',isBetaUser:true,plan:'beta'}});
 account(1);
 function View(){const [symbol,setSymbol]=useState('BINANCE:TESTUSDT');const value=usePineInstrumentContext(symbol,'M1',feed);return React.createElement('div',null,
 React.createElement('pre',{id:'metadata'},JSON.stringify(value)),
 React.createElement('button',{onClick:()=>account(2)},'Switch account'),
 React.createElement('button',{onClick:()=>feed.reset()},'Reset feed'),
 React.createElement('button',{onClick:()=>setSymbol('COINBASE:TESTUSDT')},'Other provider'))}
 const element=document.createElement('div');document.body.appendChild(element);createRoot(element).render(React.createElement(View));
}

export async function run(request) {
  try { return {ok:true,value:await createPineRuntimeJob(request).promise}; }
  catch(error) { return {ok:false,error:{name:error.name,code:error.code,message:error.message}}; }
}`,
      resolveDir: path.join(root, "frontend/src/lib"), loader: "ts", sourcefile: "instrument69-host.ts",
    },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "instrument69Host",
    plugins: [{ name: "frozen-worker", setup(builder) {
      builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "production" }));
      builder.onLoad({ filter: /.*/, namespace: "production" }, () => ({ contents: `export default ${JSON.stringify(workerPath)}`, loader: "js" }));
    } }],
  });
  workerRequests = [];
  unexpectedRequests = [];
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><title>Production strategy fill verification</title><script src="/host.js"></script>');
    } else if (pathname === "/host.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(fixture.outputFiles[0].contents);
    } else if (pathname === workerPath) {
      workerRequests.push(pathname);
      response.setHeader("Content-Type", "text/javascript");
      response.end(workerBytes);
    } else if (pathname === "/favicon.ico") {
      response.statusCode = 204;
      response.end();
    } else {
      unexpectedRequests.push(pathname);
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("production opaque worker sizes fractional positions with supplied instrument metadata", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  const outcomes = [];
  for (const scenario of cases69) {
    const request = { action: "run", source: scenario.source, inputs: {}, bars: bars69, mode: "historical", context: scenario.context ?? context69 };
    const output = await page.evaluate(request => (window as any).instrument69Host.run(request), request);
    outcomes.push({ name: scenario.name, request, output });
    expect(output.ok, `${scenario.name}: ${JSON.stringify(output.error)}`).toBe(true);
    expect(output.value.source).toBe(scenario.source);
    expect(ledger69(output.value), scenario.name).toEqual(scenario.expected);
    expect(output.value.diagnostics.some((d:any)=>d.code==="SYMBOL_FILTER_SCOPE")).toBe(true);
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  }
  const infoOutput = await page.evaluate(request => (window as any).instrument69Host.run(request), {action:"run",source:info69,bars:bars69,context:context69});
  expect(infoOutput.ok).toBe(true);
  expect(Object.fromEntries(infoOutput.value.plots.map((p:any)=>[p.name,p.points.map((x:any)=>x.value)]))).toEqual(Object.fromEntries(Object.entries({Minimum:.05,Tick:.03,Move:3,Scale:100,Point:1,Quote:1,Base:1}).map(([k,v])=>[k,[v,v,v]])));
  for(const context of [{...context69,quantityStep:1.25e-10},{...context69,mintick:1.234567891234567e-10}]) {
    const output=await page.evaluate(request => (window as any).instrument69Host.run(request),{action:"run",source:'//@version=6\nindicator("Never")\nruntime.error("BODY_RAN")',bars:bars69,context});
    expect(output).toMatchObject({ok:false,error:{code:"INVALID_CONTEXT"}});
    expect(output.error.message).not.toContain("BODY_RAN");
  }
  expect(workerRequests).toHaveLength(cases69.length+1);

  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
  const directory = path.join(artifacts, info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "opaque-worker.json"), JSON.stringify({
    project: info.project.name, workerPath, workerBytes: workerBytes.length,
    workerSha256: createHash("sha256").update(workerBytes).digest("hex"),
    outcomes, pageErrors: errors, workerRequests, unexpectedRequests,
    limitation: "Emulated Chromium widths; actual production opaque-worker ledgers, no rendered UI or complete TradingView equivalence claim.",
  }, null, 2));
});


test("mounted metadata hook rejects late account results and reloads after feed reset",async({page})=>{
  const pending:any[]=[];
  const calls:{auth:string|null;url:string}[]=[];
  await page.route("**/api/live/binance/instruments?**",async route=>{
    calls.push({auth:route.request().headers()["x-edgelab-auth"]??route.request().headers()["authorization"]??null,url:route.request().url()});
    await new Promise<void>(resolve=>pending.push({route,resolve}));
  });
  const row={symbol:"TESTUSDT",status:"TRADING",asset_class:"crypto",base_asset:"TEST",quote_asset:"USDT",tick_size:.03,min_quantity:.05,quantity_step:.025};
  const release=async(index:number,step:number)=>{
    const current=pending[index];
    try {await current.route.fulfill({json:{instruments:[{...row,quantity_step:step}],total:1,provider:"binance"}});}catch{}finally{current.resolve();}
  };
  await page.goto(origin);
  await page.evaluate(()=>(window as any).instrument69Host.mountMetadata());
  const state=async()=>JSON.parse(await page.locator("#metadata").innerText());
  await expect.poll(()=>pending.length).toBe(1);
  expect(await state()).toMatchObject({loading:true});
  await page.getByRole("button",{name:"Switch account",exact:true}).click();
  await expect.poll(()=>pending.length).toBe(2);
  expect(await state()).toMatchObject({loading:true});
  await release(1,.05);
  await expect.poll(async()=>(await state()).context?.quantityStep).toBe(.05);
  await release(0,.025);
  expect((await state()).context.quantityStep).toBe(.05);
  await page.getByRole("button",{name:"Reset feed",exact:true}).click();
  await expect.poll(()=>pending.length).toBe(3);
  expect(await state()).toMatchObject({loading:true});
  await release(2,.1);
  await expect.poll(async()=>(await state()).context?.quantityStep).toBe(.1);
  await page.getByRole("button",{name:"Other provider",exact:true}).click();
  await expect.poll(async()=>(await state()).error).toContain("do not match");
  expect((await state()).context).toBeUndefined();
  expect(pending.length).toBe(3);
  expect(calls.map(call=>call.auth)).toEqual(["Bearer fixture-1","Bearer fixture-2","Bearer fixture-2"]);
  expect(calls.every(call=>new URL(call.url).searchParams.get("search")==="TESTUSDT")).toBe(true);
});
