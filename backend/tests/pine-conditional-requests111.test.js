import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const root = new URL("../../", import.meta.url).pathname;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser",
  target: "es2020", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";',
    resolveDir: root, sourcefile: "pine-conditional-requests111.ts", loader: "ts" },
})).outputFiles[0].text;
console.info("CONDITIONAL111_BINDING " + JSON.stringify({ minify: true, sealed: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const start = 1_700_000_100;
assert.equal(start % 900, 0);
const bars = Array.from({ length: 30 }, (_, i) => ({ time: start + i * 60,
  open: 9 + i, high: 12 + i, low: 8 + i, close: 10 + i, volume: 100 + i }));
const context = { symbol: "CHART:TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const source = (body, version, declaration) => "//@version=" + version + "\n" + declaration + "\n" + body;
const run = (body, { version = 6, dynamic = false, inputs = {}, action = "run",
  snapshot = bars, mode = "historical", declaration } = {}) => pine.executePineRequest({
  id: "conditional111", action, source: source(body, version, declaration ??
    ('indicator("Conditional111"' + (dynamic === "default" ? "" : ",dynamic_requests=" + dynamic) + ")")),
  inputs, mode, ...(action === "run" ? { bars: snapshot, context } : {}),
});
const values = (result, name) => result.plots.find(item => item.name === name).points.map(point => point.value);

const v5Static = [{version:5,dynamic:"default"},{version:5,dynamic:false}];
const globalStatic = [...v5Static,{version:6,dynamic:false}];
const cumulative = bars.map((_,i)=>bars.slice(0,i+1).reduce((sum,bar)=>sum+bar.close,0));
const odd = i=>i%2===1;
const sparse = (series,predicate=odd)=>series.map((value,i)=>predicate(i)?value:null);
const remote3 = bars.map((_,i)=>i<2?null:bars[Math.floor((i+1)/3)*3-1].close);
const plus = (value,amount)=>value===null?null:value+amount;
function rejected(body, options, code) {
  return assert.rejects(run(body,options),error=>{assert.equal(error.code,code,error.message);return true;});
}

// Official v5 extraction exception:
// https://www.tradingview.com/pine-script-docs/v5/concepts/other-timeframes-and-data/
// Version-specific wrapper restriction:
// https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/
test("v5 extracts only the request while conditional persistent body state stays conditional",async()=>{
  const body='f()=>\n    requested=request.security("","",ta.cum(close))\n    var int count=0\n    count+=1\n    requested+count\nfloat answer=na\nif bar_index%2==1\n    answer:=f()\nplot(answer,"Answer")';
  const expected=sparse(cumulative.map((value,i)=>value+(i+1)/2));
  for(const policy of v5Static) assert.deepEqual(values(await run(body,policy),"Answer"),expected);
});

test("dynamic requests preserve conditional request calculations and body execution in both versions",async()=>{
  const body='f()=>\n    requested=request.security("","",ta.cum(close))\n    var int count=0\n    count+=1\n    requested+count\nfloat answer=na\nif bar_index%2==1\n    answer:=f()\nplot(answer,"Answer")';
  let sum=0,count=0;
  const expected=bars.map((bar,i)=>odd(i)?(sum+=bar.close,++count,sum+count):null);
  for(const version of [5,6]) assert.deepEqual(values(await run(body,{version,dynamic:true}),"Answer"),expected);
});

test("v6 false rejects reachable and unreachable local wrapper sites before publishing",async()=>{
  const head='f()=>request.security("","",close)\ng()=>f()\nfloat answer=na\n';
  const sites=[
    'if bar_index%2==1\n    answer:=f()',
    'if false\n    answer:=f()',
    'if false\n    answer:=g()',
    'for i=0 to 1\n    answer:=f()',
    'answer:=bar_index%2==1?f():na',
  ];
  for(const site of sites) for(const action of ["prepare","run"])
    await rejected(head+site+'\nplot(answer,"Answer")',{version:6,dynamic:false,action},"COMPILE_ERROR");
});

test("direct static requests inside local blocks stay invalid in v5 and v6",async()=>{
  const body='float answer=na\nif false\n    answer:=request.security("","",close)\nplot(answer,"Answer")';
  for(const policy of globalStatic) for(const action of ["prepare","run"])
    await rejected(body,{...policy,action},"COMPILE_ERROR");
});

test("separate if and else call paths keep independent conditional counters",async()=>{
  const body='f(int step)=>\n    requested=request.security("","",ta.cum(close))\n    var int count=0\n    count+=step\n    requested+count\nfloat answer=na\nif bar_index%2==0\n    answer:=f(1)\nelse\n    answer:=f(9)\nplot(answer,"Answer")';
  const expected=cumulative.map((value,i)=>value+(i%2===0?(i/2+1):((i+1)/2)*9));
  for(const policy of v5Static) assert.deepEqual(values(await run(body,policy),"Answer"),expected);
});

test("loop wrapper bodies execute each iteration without duplicating the extracted request",async()=>{
  const body='f()=>\n    requested=request.security("","",ta.cum(close))\n    var int count=0\n    count+=1\n    requested+count\nfloat answer=na\nif bar_index%2==1\n    for j=0 to 1\n        answer:=f()\nplot(answer,"Answer")';
  const expected=sparse(cumulative.map((value,i)=>value+i+1));
  for(const policy of v5Static) assert.deepEqual(values(await run(body,policy),"Answer"),expected);
});

test("ternary wrapper calls extract the request while preserving lazy body state",async()=>{
  const body='f()=>\n    requested=request.security("","",ta.cum(close))\n    var int count=0\n    count+=1\n    requested+count\nanswer=bar_index%2==1?f():na\nplot(answer,"Answer")';
  const expected=sparse(cumulative.map((value,i)=>value+(i+1)/2));
  for(const policy of v5Static) assert.deepEqual(values(await run(body,policy),"Answer"),expected);
});

test("nested wrappers preserve actual scalar arguments and two distinct written paths",async()=>{
  const body='f(float amount)=>request.security("","",ta.cum(close)+amount)\ng(float amount)=>f(amount+2)\nh(float amount)=>g(amount*2)\nfloat first=na\nfloat second=na\nif bar_index%2==1\n    first:=h(1)\n    second:=h(9)\nplot(first,"First")\nplot(second,"Second")';
  for(const policy of v5Static) {
    const result=await run(body,policy);
    assert.deepEqual(values(result,"First"),sparse(cumulative.map(value=>value+4)));
    assert.deepEqual(values(result,"Second"),sparse(cumulative.map(value=>value+20)));
  }
});

test("immutable derived locals and named request arguments retain prerequisites only",async()=>{
  const body='f(float amount)=>\n    scaled=amount*2+1\n    requested=request.security(expression=ta.cum(close)+scaled,timeframe="",symbol="")\n    var int calls=0\n    calls+=1\n    requested+calls\nfloat answer=na\nif bar_index%2==1\n    answer:=f(amount=3)\nplot(answer,"Answer")';
  const expected=sparse(cumulative.map((value,i)=>value+7+(i+1)/2));
  for(const policy of v5Static) assert.deepEqual(values(await run(body,policy),"Answer"),expected);
});

test("saved native input IDs and unmodified source survive conditional context parameters",async()=>{
  const body='amount=input.int(2,"Amount",minval=0,maxval=20)\nframe=input.string("3","Frame",options=["3","5"])\nf(string frame,float amount)=>request.security("CHART:TEST",frame,close+amount)\nfloat answer=na\nif bar_index%2==1\n    answer:=f(frame,amount)\nplot(answer,"Answer")';
  for(const policy of v5Static) {
    const prepared=await run(body,{...policy,action:"prepare"});
    assert.deepEqual(prepared.inputDefinitions.map(item=>[item.id,item.defval]),[["in_0",2],["in_1","3"]]);
    for(const amount of [2,7]) {
      const inputs=JSON.parse(JSON.stringify({in_0:amount,in_1:"3"}));
      const result=await run(body,{...policy,inputs});
      assert.deepEqual(result.inputs,inputs);
      assert.equal(result.source,source(body,policy.version,'indicator("Conditional111"'+(policy.dynamic==="default"?"":",dynamic_requests=false")+")"));
      assert.deepEqual(values(result,"Answer"),sparse(remote3.map(value=>plus(value,amount))));
    }
  }
});

test("series actual arguments in the request expression are evaluated on every source bar",async()=>{
  const body='f(float seriesValue)=>request.security("","",ta.cum(seriesValue))\nfloat answer=na\nif bar_index%2==1\n    answer:=f(close)\nplot(answer,"Answer")';
  for(const policy of v5Static) assert.deepEqual(values(await run(body,policy),"Answer"),sparse(cumulative));
});

test("conditional tuple wrappers retain every requested field and original history",async()=>{
  const body='f()=>request.security("","",[ta.cum(close),close[1]])\nfloat first=na\nfloat previous=na\nif bar_index%2==1\n    [a,b]=f()\n    first:=a\n    previous:=b\nplot(first,"First")\nplot(previous,"Previous")';
  for(const policy of v5Static) {
    const result=await run(body,policy);
    assert.deepEqual(values(result,"First"),sparse(cumulative));
    assert.deepEqual(values(result,"Previous"),sparse(bars.map((_,i)=>i===0?null:bars[i-1].close)));
  }
});

test("global wrapper calls remain legal in v6 false without changing historical values",async()=>{
  const body='f()=>request.security("","",ta.cum(close))\nanswer=f()\nplot(answer,"Answer")';
  for(const policy of globalStatic) assert.deepEqual(values(await run(body,policy),"Answer"),cumulative);
});

test("static extraction keeps chart identity authority for visibly consumed conditional results",async()=>{
  const body='f()=>request.security("OTHER:TEST","1",close)\nfloat answer=na\nif bar_index==29\n    answer:=f()\nplot(answer,"Answer")';
  for(const policy of v5Static) await rejected(body,policy,"UNAVAILABLE_DATA");
  for(const version of [5,6]) {
    await rejected(body,{version,dynamic:true},"UNAVAILABLE_DATA");
    assert.deepEqual(values(await run(body.replace("bar_index==29","false"),{version,dynamic:true}),"Answer"),bars.map(()=>null));
  }
  const followup=await run('plot(close,"Close")');
  assert.deepEqual(values(followup,"Close"),bars.map(bar=>bar.close));
});

test("extracted wrapper requests retain the existing bounded secondary context budget",async()=>{
  const declarations='f(int amount)=>request.security("CHART:TEST","3",close+amount)';
  const calls=Array.from({length:65},(_,i)=>'    value'+i+'=f('+i+')').join("\n");
  const total=Array.from({length:65},(_,i)=>"value"+i).join("+");
  for(const policy of v5Static) await rejected(declarations+'\nfloat answer=na\nif bar_index==29\n'+calls+'\n    answer:='+total+'\nplot(answer,"Answer")',policy,"REQUEST_LIMIT");
});


test("constant declaration aliases select static and dynamic wrapper behavior",async()=>{
  const body='f()=>request.security("","",ta.cum(close))\nfloat answer=na\nif bar_index%2==1\n    answer:=f()\nplot(answer,"Answer")';
  let sum=0;
  const conditional=bars.map((bar,i)=>odd(i)?(sum+=bar.close):null);
  for(const enabled of [false,true]) {
    const declaration='const bool REQUEST_MODE='+enabled+'\nindicator("Conditional111",dynamic_requests=REQUEST_MODE)';
    const result=await run(body,{version:5,declaration});
    assert.deepEqual(values(result,"Answer"),enabled?conditional:sparse(cumulative));
  }
  const default6=await run(body,{version:6,dynamic:"default"});
  assert.deepEqual(values(default6,"Answer"),conditional);
  await rejected(body,{version:6,declaration:'const bool REQUEST_MODE=false\nindicator("Conditional111",dynamic_requests=REQUEST_MODE)'},"COMPILE_ERROR");
});

test("conditional wrapper strategy quantities preserve exact independently calculated fills",async()=>{
  const body='f()=>request.security("","",ta.cum(close))\nfloat quantity=na\nif bar_index%2==1\n    quantity:=f()\nif bar_index==3\n    strategy.entry("Entry",strategy.long,qty=quantity)\nif bar_index==9\n    strategy.close("Entry")\nplot(quantity,"Quantity")';
  const policies=[
    {version:5,flag:"",size:46},
    {version:5,flag:",dynamic_requests=false",size:46},
    {version:5,flag:",dynamic_requests=true",size:24},
    {version:6,flag:",dynamic_requests=true",size:24},
    {version:6,flag:"",size:24},
  ];
  for(const {version,flag,size} of policies) {
    const declaration='strategy("Conditional111 quantity",initial_capital=100000'+flag+')';
    const result=await run(body,{version,declaration});
    assert.equal(result.source,source(body,version,declaration));
    assert.equal(result.strategy.closedTrades.length,1);
    const trade=result.strategy.closedTrades[0];
    assert.equal(trade.size,size);
    assert.equal(trade.entry_bar_index,4);assert.equal(trade.exit_bar_index,10);
    assert.equal(trade.entry_price,13);assert.equal(trade.exit_price,19);
    assert.equal(trade.profit,6*size);
  }
});


test("an unused actual argument retains conditional side effects and is never lifted with the request",async()=>{
  const body='var array<float> touched=array.new<float>()\ntouch()=>\n    array.push(touched,close)\n    close\nf(float unused)=>request.security("","",ta.cum(close))\nfloat answer=na\nif bar_index%2==1\n    answer:=f(touch())\nplot(answer,"Answer")\nplot(array.size(touched),"Touches")';
  for(const policy of v5Static) {
    const result=await run(body,policy);
    assert.deepEqual(values(result,"Answer"),sparse(cumulative));
    assert.deepEqual(values(result,"Touches"),bars.map((_,i)=>Math.floor((i+1)/2)));
  }
});

test("a stateful expression helper runs every bar while the wrapper local counter remains sparse",async()=>{
  const body='sum()=>\n    var float total=0.0\n    total+=close\n    total\nf()=>\n    requested=request.security("","",sum())\n    var int count=0\n    count+=1\n    requested+count\nfloat answer=na\nif bar_index%2==1\n    answer:=f()\nplot(answer,"Answer")';
  for(const policy of v5Static) assert.deepEqual(values(await run(body,policy),"Answer"),sparse(cumulative.map((value,i)=>value+(i+1)/2)));
});

test("unsafe mutable static freeze remains an explicit host limitation rather than fabricated secondary values",async()=>{
  const body='var array<float> state=array.new<float>(1,0.0)\narray.set(state,0,array.get(state,0)+close)\nf()=>request.security("","",array.get(state,0))\nfloat inner=na\nif bar_index%2==1\n    inner:=f()\nplot(request.security("CHART:TEST","15",inner),"Outer")';
  for(const policy of v5Static) await rejected(body,policy,"UNSUPPORTED_REQUEST_EXPRESSION");
});


test("eager global logical operands remain valid static requests under version-specific evaluation",async()=>{
  const expressions=[
    'not na(request.security("","",close)) and true',
    'not na(request.security("","",close)) or false',
    'bar_index%2==1 and not na(request.security("","",close))',
    'bar_index%2==1 or not na(request.security("","",close))',
  ];
  for(const policy of v5Static) for(const [index,expression] of expressions.entries()) {
    const result=await run('answer='+expression+'\nplot(answer?1:0,"Answer")',policy);
    assert.deepEqual(values(result,"Answer"),bars.map((_,i)=>index===2?(i%2):1));
  }
  for(const expression of expressions.slice(0,2)) {
    const result=await run('answer='+expression+'\nplot(answer?1:0,"Answer")',{version:6,dynamic:false});
    assert.deepEqual(values(result,"Answer"),bars.map(()=>1));
  }
  for(const expression of expressions.slice(2)) for(const action of ["prepare","run"])
    await rejected('answer='+expression+'\nplot(answer?1:0,"Answer")',{version:6,dynamic:false,action},"COMPILE_ERROR");
});


test("a direct request inside a function's conditional body cannot use the v5 wrapper exception",async()=>{
  const body='f()=>\n    float value=na\n    if true\n        value:=request.security("","",close)\n    value\nplot(f(),"Answer")';
  for(const policy of globalStatic) for(const action of ["prepare","run"])
    await rejected(body,{...policy,action},"COMPILE_ERROR");
});

test("random series request context parameters cannot be accepted as static simple values",async()=>{
  const body='f(string frame)=>request.security("CHART:TEST",frame,close)\nanswer=f(str.tostring(math.random(1,3)))\nplot(answer,"Answer")';
  for(const policy of globalStatic) await rejected(body,{...policy,action:"prepare"},"COMPILE_ERROR");
});


test("shadowed local request dependencies refuse explicitly while renamed immutable locals stay supported",async()=>{
  const shadow='g(float value)=>request.security("","",ta.cum(value))\nf(float amount)=>\n    float result=na\n    if true\n        float amount=close\n        result:=g(amount)\n    result\nfloat answer=na\nif bar_index%2==1\n    answer:=f(1)\nplot(answer,"Answer")';
  const renamed=shadow.replace('float amount=close','float current=close').replace('result:=g(amount)','result:=g(current)');
  for(const policy of v5Static) {
    for(const action of ["prepare","run"]) await assert.rejects(run(shadow,{...policy,action}),error=>{
      assert.equal(error.code,"COMPILE_ERROR",error.message);
      assert.match(error.message,/shadowed local/i);
      return true;
    });
    assert.deepEqual(values(await run(renamed,policy),"Answer"),sparse(cumulative));
  }
});

test("alias expansion has a hard compiler work cap enforced inside a timeout-protected subprocess",async()=>{
  const aliases=Array.from({length:19},(_,i)=>'    a'+(i+1)+'=a'+i+'+a'+i).join("\n");
  const body='f(float value)=>request.security("","",value)\ng(float value)=>\n    a0=value\n'+aliases+'\n    f(a19)\nfloat answer=na\nif bar_index%2==1\n    answer:=g(1)\nplot(answer,"Answer")';
  const program=[
    'import {build} from "esbuild";',
    'import {createPineEnginePlugin} from '+JSON.stringify(new URL("../../scripts/pine-engine.mjs",import.meta.url).href)+';',
    'Error.stackTraceLimit=0;',
    'const bundle=(await build({bundle:true,minify:true,format:"esm",platform:"browser",target:"es2020",write:false,logLevel:"silent",plugins:[createPineEnginePlugin()],stdin:{contents:\'export * from "./frontend/src/workers/pineNative.worker.ts";\',resolveDir:'+JSON.stringify(root)+',sourcefile:"pine-conditional-requests111.ts",loader:"ts"}})).outputFiles[0].text;',
    'const pine=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));',
    'try{await pine.executePineRequest('+JSON.stringify({id:"conditional111-quota",action:"prepare",source:source(body,5,'indicator("Conditional111")')})+');process.stdout.write(JSON.stringify({ok:true}));}',
    'catch(error){process.stdout.write(JSON.stringify({ok:false,code:error.code,message:String(error.message).slice(0,4096)}));}',
  ].join("\n");
  const {stdout,stderr}=await promisify(execFile)(process.execPath,["--max-old-space-size=256","--input-type=module","-e",program],{
    cwd:root,timeout:5000,maxBuffer:16384,
  });
  assert.equal(stderr,"");
  const result=JSON.parse(stdout);
  assert.equal(result.ok,false,"exponentially expanding alias request must hit a bounded compile limit");
  assert.equal(result.code,"COMPILE_ERROR",result.message);
  assert.match(result.message,/limit|budget|quota|depth|bounded|large/i);
});


test("conditional user methods preserve receivers, default and named arguments, and separate local counters",async()=>{
  const body='method read(float self,int amount=2)=>\n    requested=request.security("","",ta.cum(close))\n    var int count=0\n    count+=1\n    requested+self+amount+count\nfloat defaults=na\nfloat explicit=na\nfloat named=na\nif bar_index%2==1\n    defaults:=close.read()\n    explicit:=close.read(5)\n    named:=close.read(amount=7)\nplot(defaults,"Default")\nplot(explicit,"Explicit")\nplot(named,"Named")';
  for(const policy of v5Static) {
    const result=await run(body,policy);
    for(const [name,amount] of [["Default",2],["Explicit",5],["Named",7]])
      assert.deepEqual(values(result,name),sparse(cumulative.map((value,i)=>value+bars[i].close+amount+(i+1)/2)));
  }
  for(const action of ["prepare","run"]) await rejected(body,{version:6,dynamic:false,action},"COMPILE_ERROR");
});
