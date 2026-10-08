import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = (await build({
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  write: false,
  logLevel: "silent",
  plugins: [createPineEnginePlugin()],
  define: { "import.meta.env": "{}" },
  stdin: {
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineInstrumentContext.ts"; export * from "./frontend/src/lib/pineProtocol.ts";',
    loader: "ts",
    resolveDir: root,
    sourcefile: "pine-instrument69-fixture.ts",
  },
})).outputFiles[0].text + "\n//# sourceURL=edgelab-instrument69-minified-worker.mjs\n";
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
console.info("INSTRUMENT69_BINDING " + JSON.stringify({
  minify: true,
  bundleSha256: sha(bundle),
  bundleBytes: Buffer.byteLength(bundle),
  workerSourceSha256: sha(fs.readFileSync(new URL("../../frontend/src/workers/pineNative.worker.ts", import.meta.url))),
  engineManifestSha256: sha(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))),
}));
import { cases69, context69, bars69, ledger69, info69 } from "./fixtures/pine-instrument69.mjs";
const request=(source,context=context69)=>({id:"instrument69",action:"run",source,bars:bars69,inputs:{},context});
for(const scenario of cases69) test(scenario.name,async()=>{
  const result=await pine.executePineRequest(request(scenario.source,scenario.context));
  assert.deepEqual(ledger69(result),scenario.expected);
  assert.ok(result.diagnostics.some(d=>d.code==="SYMBOL_FILTER_SCOPE"));
  assert.ok(!result.diagnostics.some(d=>d.code==="DEFAULT_SYMBOL_METADATA"));
});
test("actual minimum, price tick, point value and currencies reach Pine syminfo",async()=>{
  const result=await pine.executePineRequest(request(info69));
  assert.deepEqual(Object.fromEntries(result.plots.map(p=>[p.name,p.points.map(x=>x.value)])),Object.fromEntries(Object.entries({Minimum:.05,Tick:.03,Move:3,Scale:100,Point:1,Quote:1,Base:1}).map(([k,v])=>[k,[v,v,v]])));
});
test("unsupported numeric precision refuses execution before the Pine body",async()=>{
  for(const context of [{...context69,quantityStep:1.25e-10},{...context69,mincontract:1.25e-10},{...context69,mintick:1.234567891234567e-10}]) {
    await assert.rejects(pine.executePineRequest(request('//@version=6\nindicator("Never")\nruntime.error("BODY_RAN")',context)),e=>{assert.equal(e.code,"INVALID_CONTEXT");assert.doesNotMatch(e.message,/BODY_RAN/);return true;});
  }
});
test("only an explicitly matching Binance instrument supplies metadata",()=>{
  const row={symbol:"TESTUSDT",status:"TRADING",asset_class:"crypto",base_asset:"TEST",quote_asset:"USDT",tick_size:.03,min_quantity:.05,quantity_step:.025};
  assert.deepEqual(pine.pineContextWithBinanceInstrument("BINANCE:TESTUSDT","M1","TESTUSDT",row),context69);
  for(const symbol of ["COINBASE:TESTUSDT","BINANCE:OTHERUSDT"]) assert.throws(()=>pine.pineContextWithBinanceInstrument(symbol,"M1","TESTUSDT",row),e=>e.code==="INVALID_CONTEXT");
  for(const override of [{symbol:"OTHERUSDT"},{tick_size:null},{quantity_step:0},{min_quantity:Infinity},{quantity_step:1.25e-10}]) assert.throws(()=>pine.pineContextWithBinanceInstrument("TESTUSDT","M1","TESTUSDT",{...row,...override}),e=>e.code==="INVALID_CONTEXT");
});

test("live indicator updates retain actual symbol metadata",async()=>{
  const executor=pine.createPineLiveExecutor();
  const initial={protocol:"pine-live-v1",sessionId:"instrument69-live",sequence:0,action:"start",request:{...request(info69),id:"instrument69-live:0",mode:"live"}};
  await executor.execute(initial);
  const result=await executor.execute({protocol:"pine-live-v1",sessionId:initial.sessionId,sequence:1,action:"update",bar:{...bars69.at(-1),time:bars69.at(-1).time+60},confirmed:false});
  for(const [name,value] of Object.entries({Minimum:.05,Tick:.03,Move:3,Scale:100,Quote:1,Base:1})) assert.equal(result.plots.find(p=>p.name===name).points.at(-1).value,value);
  executor.dispose();

});
