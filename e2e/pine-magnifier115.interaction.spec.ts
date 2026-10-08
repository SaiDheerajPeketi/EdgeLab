import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {context115,start115,minutes115,bars115,bracket115} from "../backend/tests/fixtures/pine-magnifier115.mjs";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, ".artifacts/pine-magnifier115/browser");
const port = Number(process.env.EDGELAB_PINE_MAGNIFIER115_PORT ?? 45315);
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
  const expected = process.env.EDGELAB_PINE_MAGNIFIER115_SHA;
  if (expected) expect(createHash("sha256").update(workerBytes).digest("hex")).toBe(expected);
  const fixture = await build({
    stdin: {
      contents: `import {createPineRuntimeJob} from './pineRuntime';
export async function run(request) {
  try { return {ok:true,value:await createPineRuntimeJob(request).promise}; }
  catch(error) { return {ok:false,error:{name:error.name,code:error.code,message:error.message}}; }
}`,
      resolveDir: path.join(root, "frontend/src/lib"), loader: "ts", sourcefile: "magnifier115-host.ts",
    },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "magnifier115Host",
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
      response.end('<!doctype html><title>Production historical magnifier verification</title><script src="/host.js"></script>');
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

const points=(result:any,name:string)=>result.plots.find((plot:any)=>plot.name===name).points.map((point:any)=>point.value);
const ledger=(result:any)=>result.strategy.closedTrades.map((trade:any)=>[trade.entry_price,trade.exit_price,trade.size,trade.profit]);

test("production opaque worker uses genuine smaller candles without changing chart calculation slots",async({page},info)=>{
 const requestStart=workerRequests.length;
 const errors:string[]=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.goto(origin);
 await page.evaluate(()=>{
  (window as any).seenSandboxes=[];
  new MutationObserver(records=>{
   for(const record of records)for(const node of Array.from(record.addedNodes))
    if(node instanceof HTMLIFrameElement)(window as any).seenSandboxes.push(node.getAttribute("sandbox"));
  }).observe(document.body,{childList:true,subtree:true});
 });
 const outcomes:any[]=[];
 const execute=async(source:string,{minutes=minutes115(),sourceSnapshot={timeframe:"1",bars:minutes},inputs={},strategySettings,action="run"}:{minutes?:any[],sourceSnapshot?:any,inputs?:Record<string,any>,strategySettings?:any,action?:string}={})=>{
  const request={id:"magnifier115-browser",action,source,inputs,...(strategySettings===undefined?{}:{strategySettings}),
   ...(action==="run"?{context:context115,bars:bars115,mode:"historical",...(sourceSnapshot===null?{}:{sourceSnapshot})}:{})};
  const output=await page.evaluate(request=>(window as any).magnifier115Host.run(request),request);
  outcomes.push({request,output});
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  return output;
 };
 for(const version of [5,6]) {
  for(const fill of [false,true]) {
   const original=bracket115({version,fill});
   for(const path of ["low-first","high-first"]) {
    const output=await execute(original,{minutes:minutes115(path)});
    expect(output.ok,JSON.stringify(output.error)).toBe(true);
    const result=output.value;
    expect(result.source).toBe(original);
    expect(result.inputs).toEqual({});
    expect(result.pineVersion).toBe(version);
    expect(result.strategy.config.use_bar_magnifier).toBe(true);
    expect(result.strategy.config.calc_on_order_fills).toBe(fill);
    expect(ledger(result)).toEqual(path==="low-first"?[[90,115,1,25]]:[]);
    expect(points(result,"Calls")).toEqual([0,fill?(path==="low-first"?3:2):1]);
    expect(points(result,"Position")).toEqual([0,path==="low-first"?0:1]);
    expect(points(result,"Close")).toEqual([100,100]);
    expect(points(result,"Previous")).toEqual([null,100]);
    expect(points(result,"SMA")).toEqual([null,100]);
    expect(result.plots.every((plot:any)=>JSON.stringify(plot.points.map((point:any)=>point.time))===JSON.stringify(bars115.map(bar=>bar.time)))).toBe(true);
    if(path==="low-first") {
     const trade=result.strategy.closedTrades[0];
     expect([trade.entry_time,trade.exit_time,trade.entry_bar_index,trade.exit_bar_index]).toEqual([start115+300,start115+420,1,1]);
     expect(result.strategy.metrics.netprofit).toBe(25);
     expect(result.strategy.openTrades).toEqual([]);
    } else {
     expect(result.strategy.openTrades).toHaveLength(1);
     expect([result.strategy.openTrades[0].entry_price,result.strategy.openTrades[0].entry_time]).toEqual([90,start115+420]);
     expect(result.strategy.metrics.netprofit).toBe(0);
    }
    expect(result.diagnostics.some((item:any)=>item.code==="BAR_MAGNIFIER_COVERAGE"&&item.message.includes("2 of 2"))).toBe(true);
   }
   const fallback=await execute(original,{sourceSnapshot:null});
   expect(fallback.ok,JSON.stringify(fallback.error)).toBe(true);
   expect(ledger(fallback.value)).toEqual([[90,115,1,25]]);
   expect(points(fallback.value,"Calls")).toEqual([0,fill?3:1]);
   expect(fallback.value.diagnostics.some((item:any)=>item.code==="BAR_MAGNIFIER_COVERAGE"&&item.message.includes("0 of 2"))).toBe(true);
  }
  const inconsistent=minutes115();
  inconsistent[7].high=130;
  const bad=await execute(bracket115({version}),{minutes:inconsistent});
  expect(bad.ok).toBe(false);
  expect(bad.error.code).toBe("UNAVAILABLE_DATA");
  expect(bad).not.toHaveProperty("value");
  const source=bracket115({version}).replace("//@version="+version+"\n","//@version="+version+'\nenabled=input.bool(false,"Actual children")\n').replace("use_bar_magnifier=true","use_bar_magnifier=enabled");
  const prepared=await execute(source,{action:"prepare"});
  expect(prepared.ok,JSON.stringify(prepared.error)).toBe(true);
  expect(prepared.value.inputDefinitions.map((definition:any)=>[definition.id,definition.defval])).toEqual([["in_0",false]]);
  const inputs=JSON.parse(JSON.stringify({in_0:true}));
  const saved=await execute(source,{inputs,minutes:minutes115("high-first")});
  expect(saved.ok,JSON.stringify(saved.error)).toBe(true);
  expect(saved.value.source).toBe(source);
  expect(saved.value.inputs).toEqual(inputs);
  expect(ledger(saved.value)).toEqual([]);
  const strategySettings=JSON.parse(JSON.stringify({use_bar_magnifier:false,calc_on_order_fills:true}));
  const override=await execute(source,{inputs,strategySettings,minutes:minutes115("high-first")});
  expect(override.ok,JSON.stringify(override.error)).toBe(true);
  expect(override.value.source).toBe(source);
  expect(override.value.inputs).toEqual(inputs);
  expect(ledger(override.value)).toEqual([[90,115,1,25]]);
  expect(points(override.value,"Calls")).toEqual([0,3]);
  expect(override.value.strategy.config.use_bar_magnifier).toBe(false);
  expect(override.value.strategy.config.calc_on_order_fills).toBe(true);
  expect(strategySettings).toEqual({use_bar_magnifier:false,calc_on_order_fills:true});
 }
 const again=await execute('//@version=6\nindicator("After magnifier errors")\nplot(close,"Root")');
 expect(again.ok,JSON.stringify(again.error)).toBe(true);
 expect(points(again.value,"Root")).toEqual([100,100]);
 expect(errors).toEqual([]);
 expect(unexpectedRequests).toEqual([]);
 const sandboxes=await page.evaluate(()=>(window as any).seenSandboxes);
 expect(sandboxes).toHaveLength(outcomes.length);
 expect(sandboxes.every((sandbox:string)=>sandbox==="allow-scripts")).toBe(true);
 expect(workerRequests.slice(requestStart)).toHaveLength(outcomes.length);
 fs.mkdirSync(path.join(artifacts,info.project.name),{recursive:true});
 fs.writeFileSync(path.join(artifacts,info.project.name,"opaque-worker.json"),JSON.stringify({
  workerPath,bytes:workerBytes.length,sha256:createHash("sha256").update(workerBytes).digest("hex"),
  outcomes,sandboxes,errors,unexpectedRequests,workerRequests:workerRequests.slice(requestStart),
 },null,2));
});
