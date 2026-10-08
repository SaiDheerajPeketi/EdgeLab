import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, ".artifacts/pine-conditional111/browser");
const port = Number(process.env.EDGELAB_PINE_CONDITIONAL111_PORT ?? 45311);
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
      resolveDir: path.join(root, "frontend/src/lib"), loader: "ts", sourcefile: "conditional111-host.ts",
    },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "conditional111Host",
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
      response.end('<!doctype html><title>Production conditional request verification</title><script src="/host.js"></script>');
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
const bars=Array.from({length:30},(_,i)=>({time:start+i*60,open:9+i,high:12+i,low:8+i,close:10+i,volume:100+i}));
const context={symbol:"CHART:TEST",timeframe:"1",mintick:.01,pointvalue:1};
const cumulative=bars.map((_,i)=>bars.slice(0,i+1).reduce((sum,bar)=>sum+bar.close,0));
const points=(result:any,name:string)=>result.plots.find((plot:any)=>plot.name===name).points.map((point:any)=>point.value);
const source=(body:string,version:number,dynamic:boolean|string="default")=>'//@version='+version+'\nindicator("Conditional111"'+(dynamic==="default"?"":",dynamic_requests="+dynamic)+')\n'+body;

test("production opaque worker separates extracted request histories from conditional wrapper bodies",async({page},info)=>{
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin);
  await page.evaluate(()=>{
    (window as any).seenSandboxes=[];
    new MutationObserver(records=>{for(const record of records)for(const node of Array.from(record.addedNodes))
      if(node instanceof HTMLIFrameElement)(window as any).seenSandboxes.push(node.getAttribute("sandbox"));
    }).observe(document.body,{childList:true,subtree:true});
  });
  const outcomes:any[]=[];
  const execute=async(source:string,inputs:Record<string,unknown>={},action="run")=>{
    const request={action,source,inputs,...(action==="run"?{bars,context,mode:"historical"}:{})};
    const output=await page.evaluate(request=>(window as any).conditional111Host.run(request),request);
    outcomes.push({request,output});
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
    return output;
  };
  const baseline='f()=>\n    requested=request.security("","",ta.cum(close))\n    var int count=0\n    count+=1\n    requested+count\nfloat answer=na\nif bar_index%2==1\n    answer:=f()\nplot(answer,"Answer")';
  for(const dynamic of ["default",false]) {
    const original=source(baseline,5,dynamic);
    const output=await execute(original);
    expect(output.ok,JSON.stringify(output.error)).toBe(true);
    expect(output.value.source).toBe(original);
    expect(points(output.value,"Answer")).toEqual(cumulative.map((value,i)=>i%2?value+(i+1)/2:null));
  }
  for(const version of [5,6]) {
    let sum=0,count=0;
    const expected=bars.map((bar,i)=>i%2?(sum+=bar.close,++count,sum+count):null);
    const output=await execute(source(baseline,version,true));
    expect(output.ok,JSON.stringify(output.error)).toBe(true);
    expect(points(output.value,"Answer")).toEqual(expected);
  }
  const saved='amount=input.int(2,"Amount",minval=0,maxval=20)\nframe=input.string("3","Frame",options=["3","5"])\nf(string frame,float amount)=>request.security(expression=close+amount,symbol="CHART:TEST",timeframe=frame)\ng(string frame,float amount)=>f(frame,amount)\nfloat first=na\nfloat second=na\nif bar_index%2==1\n    first:=g(frame,amount)\n    second:=g(frame,amount+5)\nplot(first,"First")\nplot(second,"Second")';
  const savedSource=source(saved,5,false);
  const prepared=await execute(savedSource,{},"prepare");
  expect(prepared.ok,JSON.stringify(prepared.error)).toBe(true);
  expect(prepared.value.inputDefinitions.map((item:any)=>[item.id,item.defval])).toEqual([["in_0",2],["in_1","3"]]);
  for(const amount of [2,7]) {
    const inputs=JSON.parse(JSON.stringify({in_0:amount,in_1:"3"}));
    const output=await execute(savedSource,inputs);
    expect(output.ok,JSON.stringify(output.error)).toBe(true);
    expect(output.value.source).toBe(savedSource);
    expect(output.value.inputs).toEqual(inputs);
    const remote=bars.map((_,i)=>i<2?null:bars[Math.floor((i+1)/3)*3-1].close);
    expect(points(output.value,"First")).toEqual(remote.map((value,i)=>i%2&&value!==null?value+amount:null));
    expect(points(output.value,"Second")).toEqual(remote.map((value,i)=>i%2&&value!==null?value+amount+5:null));
  }
  const tuple='f()=>request.security("","",[ta.cum(close),close[1]])\nfloat first=na\nfloat previous=na\nif bar_index%2==1\n    [a,b]=f()\n    first:=a\n    previous:=b\nplot(first,"First")\nplot(previous,"Previous")';
  const tupleOutput=await execute(source(tuple,5));
  expect(tupleOutput.ok,JSON.stringify(tupleOutput.error)).toBe(true);
  expect(points(tupleOutput.value,"First")).toEqual(cumulative.map((value,i)=>i%2?value:null));
  expect(points(tupleOutput.value,"Previous")).toEqual(bars.map((_,i)=>i%2?bars[i-1].close:null));
  const touches='var array<float> touched=array.new<float>()\ntouch()=>\n    array.push(touched,close)\n    close\nf(float unused)=>request.security("","",ta.cum(close))\nfloat answer=na\nif bar_index%2==1\n    answer:=f(touch())\nplot(answer,"Answer")\nplot(array.size(touched),"Touches")';
  const touchOutput=await execute(source(touches,5,false));
  expect(touchOutput.ok,JSON.stringify(touchOutput.error)).toBe(true);
  expect(points(touchOutput.value,"Answer")).toEqual(cumulative.map((value,i)=>i%2?value:null));
  expect(points(touchOutput.value,"Touches")).toEqual(bars.map((_,i)=>Math.floor((i+1)/2)));
  const forbidden='f()=>request.security("","",close)\ng()=>f()\nfloat answer=na\nif false\n    answer:=g()\nplot(answer,"Answer")';
  for(const action of ["prepare","run"]) {
    const output=await execute(source(forbidden,6,false),{},action);
    expect(output.ok).toBe(false);expect(output.error.code).toBe("COMPILE_ERROR");
  }
  const foreign='f()=>request.security("OTHER:TEST","1",close)\nfloat answer=na\nif bar_index==29\n    answer:=f()\nplot(answer,"Answer")';
  const refused=await execute(source(foreign,5));
  expect(refused.ok).toBe(false);expect(refused.error.code).toBe("UNAVAILABLE_DATA");
  const ordinary=await execute(source('plot(close,"Close")',6));
  expect(ordinary.ok,JSON.stringify(ordinary.error)).toBe(true);
  expect(points(ordinary.value,"Close")).toEqual(bars.map(bar=>bar.close));
  const sandboxes=await page.evaluate(()=>(window as any).seenSandboxes);
  expect(sandboxes).toHaveLength(outcomes.length);
  expect(sandboxes.every((tokens:string)=>tokens==="allow-scripts")).toBe(true);
  expect(workerRequests).toHaveLength(outcomes.length);
  expect(unexpectedRequests).toEqual([]);expect(errors).toEqual([]);
  const directory=path.join(artifacts,info.project.name);
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,"opaque-worker.json"),JSON.stringify({
    workerPath,workerBytes:workerBytes.length,workerSha256:createHash("sha256").update(workerBytes).digest("hex"),
    sandboxes,outcomes,pageErrors:errors,workerRequests,unexpectedRequests,
    limitation:"Real frozen production opaque-worker numerical gate at emulated Chromium widths; no UI or complete TradingView parity claim.",
  },null,2));
});
