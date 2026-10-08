import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, ".artifacts/pine-lower112/browser");
const port = Number(process.env.EDGELAB_PINE_LOWER112_PORT ?? 45312);
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
export async function run(request) {
  try { return {ok:true,value:await createPineRuntimeJob(request).promise}; }
  catch(error) { return {ok:false,error:{name:error.name,code:error.code,message:error.message}}; }
}`,
      resolveDir: path.join(root, "frontend/src/lib"), loader: "ts", sourcefile: "lower112-host.ts",
    },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "lower112Host",
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
      response.end('<!doctype html><title>Production owned intrabar verification</title><script src="/host.js"></script>');
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


const start=1_700_000_100;
let state=0x112;
const minutes=Array.from({length:40},(_,i)=>{const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};const open=80+next()%41,close=80+next()%41;return {time:start+i*60,open,close,high:Math.max(open,close)+1+next()%6,low:Math.min(open,close)-1-next()%6,volume:100+next()%201};});
const chart=Array.from({length:8},(_,i)=>{const a=minutes.slice(i*5,i*5+5);return {time:a[0].time,open:a[0].open,high:Math.max(...a.map(b=>b.high)),low:Math.min(...a.map(b=>b.low)),close:a[4].close,volume:a.reduce((s,b)=>s+b.volume,0)};});
const points=(r:any,n:string)=>r.plots.find((p:any)=>p.name===n).points.map((p:any)=>p.value);

test("production opaque worker evaluates owned minute intrabars with source and saved inputs intact",async({page},info)=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto(origin);
 await page.evaluate(()=>{(window as any).seenSandboxes=[];new MutationObserver(records=>{for(const r of records)for(const n of Array.from(r.addedNodes))if(n instanceof HTMLIFrameElement)(window as any).seenSandboxes.push(n.getAttribute("sandbox"));}).observe(document.body,{childList:true,subtree:true});});
 const outcomes:any[]=[];
 const execute=async(source:string,inputs:Record<string,unknown>={},action="run",snapshot=minutes)=>{
  const request={id:"lower112-browser",action,source,inputs,...(action==="run"?{context:{symbol:"CHART:TEST",timeframe:"5",mintick:.01,pointvalue:1},bars:chart,sourceSnapshot:{timeframe:"1",bars:snapshot},mode:"historical"}:{})};
  const output=await page.evaluate(request=>(window as any).lower112Host.run(request),request);outcomes.push({request,output});await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);return output;
 };
 for(const version of [5,6]){
  const original='//@version='+version+'\nindicator("Lower112 browser",dynamic_requests=false)\nlength=input.int(2,"Length",minval=1,maxval=10)\nf()=>[close,ta.sma(close,length),time]\n[c,m,t]=request.security_lower_tf("CHART:TEST","1",f())\nplot(array.size(c),"Count")\nplot(array.get(c,0),"First")\nplot(array.get(c,4),"Last")\nplot(array.get(m,4),"SMA")\nplot(array.get(t,0),"Time")\nplot(request.security("CHART:TEST","1",close,lookahead=barmerge.lookahead_on),"On")';
  const prep=await execute(original,{},"prepare");expect(prep.ok,JSON.stringify(prep.error)).toBe(true);expect(prep.value.inputDefinitions.map((d:any)=>[d.id,d.defval])).toEqual([["in_0",2]]);
  for(const length of [2,3]){
   const inputs=JSON.parse(JSON.stringify({in_0:length})),out=await execute(original,inputs);expect(out.ok,JSON.stringify(out.error)).toBe(true);expect(out.value.source).toBe(original);expect(out.value.inputs).toEqual(inputs);
   expect(points(out.value,"Count")).toEqual(chart.map(()=>5));expect(points(out.value,"First")).toEqual(chart.map((_,i)=>minutes[i*5].close));expect(points(out.value,"Last")).toEqual(chart.map((_,i)=>minutes[i*5+4].close));expect(points(out.value,"On")).toEqual(chart.map((_,i)=>minutes[i*5].close));expect(points(out.value,"Time")).toEqual(chart.map(b=>b.time*1000));
   points(out.value,"SMA").forEach((v:number,i:number)=>expect(v).toBeCloseTo(minutes.slice(i*5+5-length,i*5+5).reduce((s,b)=>s+b.close,0)/length,8));
  }
 }
 const prefix=minutes.slice(0,12);
 const partialSource='//@version=6\nindicator("Partial112")\na=request.security_lower_tf("CHART:TEST","1",close)\nplot(array.size(a),"Count")\nplot(request.security("CHART:TEST","15",close),"Higher")';
 const partialRequest={id:"partial112",action:"run",source:partialSource,inputs:{},mode:"historical",context:{symbol:"CHART:TEST",timeframe:"5"},sourceSnapshot:{timeframe:"1",bars:prefix},bars:Array.from({length:3},(_,i)=>{const group=prefix.slice(i*5,i*5+5);return {time:group[0].time,open:group[0].open,close:group.at(-1)!.close,high:Math.max(...group.map(b=>b.high)),low:Math.min(...group.map(b=>b.low)),volume:group.reduce((sum,b)=>sum+b.volume,0)};})};
 const partial=await page.evaluate(r=>(window as any).lower112Host.run(r),partialRequest);outcomes.push({request:partialRequest,output:partial});expect(partial.ok,JSON.stringify(partial.error)).toBe(true);expect(points(partial.value,"Count")).toEqual([5,5,2]);expect(points(partial.value,"Higher")).toEqual([null,null,null]);
 const foreign=await execute('//@version=6\nindicator("Foreign112")\nplot(request.security("OTHER:TEST","1",close))');expect(foreign.ok).toBe(false);expect(foreign.error.code).toBe("UNAVAILABLE_DATA");
 const again=await execute('//@version=6\nindicator("Follow112")\nplot(close,"Root")');expect(again.ok,JSON.stringify(again.error)).toBe(true);expect(points(again.value,"Root")).toEqual(chart.map(b=>b.close));
 expect(errors).toEqual([]);expect(unexpectedRequests).toEqual([]);const sandboxes=await page.evaluate(()=>(window as any).seenSandboxes);expect(sandboxes).toHaveLength(outcomes.length);expect(sandboxes.every((s:string)=>s==="allow-scripts")).toBe(true);
 fs.mkdirSync(path.join(artifacts,info.project.name),{recursive:true});fs.writeFileSync(path.join(artifacts,info.project.name,"opaque-worker.json"),JSON.stringify({workerPath,bytes:workerBytes.length,sha256:createHash("sha256").update(workerBytes).digest("hex"),outcomes,sandboxes,errors,unexpectedRequests},null,2));
});
