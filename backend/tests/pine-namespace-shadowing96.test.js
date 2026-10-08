import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {build} from "esbuild";
import {createPineEnginePlugin} from "../../scripts/pine-engine.mjs";

// Keep genuine runtime failures concise instead of printing the entire data URL.
Error.stackTraceLimit=0;
const root=new URL("../../",import.meta.url).pathname;
const bundle=(await build({bundle:true,minify:true,format:"esm",platform:"browser",write:false,
 logLevel:"silent",plugins:[createPineEnginePlugin()],stdin:{loader:"ts",resolveDir:root,
 sourcefile:"pine-namespace-shadowing96.ts",
 contents:'export {PineTS,Indicator} from "pinets";export * from "./frontend/src/workers/pineNative.worker.ts";'
 }})).outputFiles[0].text;
console.info("NAMESPACE96_BINDING "+JSON.stringify({minify:true,sealed:true,
 bundleSha256:createHash("sha256").update(bundle).digest("hex"),
 manifestSha256:createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json",import.meta.url))).digest("hex")}));
const {PineTS,Indicator,executePineRequest}=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const closes=[10,20,30];
const rawBars=closes.map((close,index)=>({openTime:1700000000000+index*60000,closeTime:Date.now()+3600000,open:close-1,high:close+2,low:close-2,close,volume:10}));
const bars=rawBars.map(b=>({time:b.openTime/1000,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume}));
const source=(body,version=5,declaration='indicator("Namespaces96")')=>"//@version="+version+"\n"+declaration+"\n"+body;
const execute=(body,{version=5,inputs={},action="run",declaration}={})=>executePineRequest({id:"namespace96",action,source:source(body,version,declaration),inputs,
 ...(action==="run"?{bars,context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1}}:{})});
const rawRun=(body,version=5)=>new PineTS(rawBars,"TEST","1").run(new Indicator(source(body,version)));
const rawValues=(r,name)=>r.plots[name]?.data.map(p=>Number.isNaN(p.value)?null:p.value);
const workerValues=(r,name)=>r.plots.find(p=>p.name===name)?.points.map(p=>p.value);
const cell="type Cell\n    float price\n";
async function both(body,expected,version=5){
 const raw=await rawRun(body,version),worker=await execute(body,{version});
 for(const [name,values] of Object.entries(expected)){
  assert.deepEqual(rawValues(raw,name),values,"raw "+name);
  assert.deepEqual(workerValues(worker,name),values,"worker "+name);
 }
 assert.equal(worker.source,source(body,version));
}
// Rules differ by Pine version:
// https://www.tradingview.com/pine-script-docs/v5/language/objects/#shadowing
// https://www.tradingview.com/pine-script-docs/language/variable-declarations/#shadowing

test("v5 inferred and explicitly typed UDT namespace receivers preserve real field values",async()=>{
 for(const declaration of ["box=Cell.new(close)","Cell box=Cell.new(close)"]){
  await both(cell+declaration+'\nplot(box.price,"Field")',{Field:closes});
 }
});

test("v5 UDT aliases share mutations while static copies stay independent",async()=>{
 await both(cell+'box=Cell.new(close)\nalias=box\nalias.price+=2\ncopied=Cell.copy(box)\ncopied.price+=100\nplot(box.price,"Original")\nplot(alias.price,"Alias")\nplot(copied.price,"Copy")',
 {Original:[12,22,32],Alias:[12,22,32],Copy:[112,122,132]});
});

test("v5 nested lexical namespace shadows do not replace outer object bindings",async()=>{
 const body=cell+'read(Cell value)=>\n    float result=0\n    if true\n        Cell box=Cell.new(value.price+100)\n        if true\n            Cell box=Cell.new(value.price+200)\n            result:=box.price\n        result+=box.price\n    result\nCell box=Cell.new(close)\nplot(read(box),"Nested")\nplot(box.price,"Global")';
 await both(body,{Nested:[320,340,360],Global:closes});
});

test("v5 typed ordinary function and method parameters use their object receiver",async()=>{
 const body=cell+'read(Cell box)=>box.price+1\nread(int box)=>100+box\nmethod scale(Cell box,float factor)=>box.price*factor\ncurrent=Cell.new(close)\nplot(read(current),"UDT overload")\nplot(read(2),"Primitive overload")\nplot(current.scale(3.0),"Method")';
 await both(body,{"UDT overload":[11,21,31],"Primitive overload":[102,102,102],Method:[30,60,90]});
});

test("v5 namespace names beyond box resolve UDT fields through the lexical object",async()=>{
 const body=cell+'Cell ta=Cell.new(close+1)\nCell math=Cell.new(close+2)\nCell syminfo=Cell.new(close+3)\nplot(ta.price,"TA")\nplot(math.price,"Math")\nplot(syminfo.price,"Info")';
 await both(body,{TA:[11,21,31],Math:[12,22,32],Info:[13,23,33]});
});

test("v5 typed enum and numeric methods retain namespace receivers and genuine input overrides",async()=>{
 const body=cell+'enum Side\n    a="Same"\n    b="Same"\nmethod bump(Cell box,int amount)=>box.price+amount\nmethod add(Cell box,Side choice)=>box.price+(choice==Side.a?11:22)\nchoice=input.enum(Side.a,"Side")\namount=input.int(3,"Amount")\nCell box=Cell.new(close)\nplot(box.add(choice),"Enum")\nplot(box.bump(amount),"Int")';
 const prepared=await execute(body,{action:"prepare"});
 assert.deepEqual(prepared.inputDefinitions.map(d=>d.id),["in_0","in_1"]);
 const result=await execute(body,{inputs:{in_0:"Side.b",in_1:7}});
 assert.deepEqual(workerValues(result,"Enum"),[32,42,52]);
 assert.deepEqual(workerValues(result,"Int"),[17,27,37]);
 assert.deepEqual(result.inputs,{in_0:"Side.b",in_1:7});
 assert.equal(result.source,source(body));
});

test("UDT type named box keeps its own constructor and copy in both Pine versions",async()=>{
 const body='type box\n    float price\ncurrent=box.new(close)\ncopied=box.copy(current)\ncopied.price+=100\nplot(current.price,"Original")\nplot(copied.price,"Copy")';
 for(const version of [5,6]) await both(body,{Original:closes,Copy:[110,120,130]},version);
});

test("UDT fields named after namespaces remain valid in both Pine versions",async()=>{
 const body=cell+'type Holder\n    Cell box\n    float math\ncurrent=Holder.new(Cell.new(close),5.0)\nplot(current.box.price,"Nested field")\nplot(current.math,"Scalar field")\nCell plot_linestyle=Cell.new(close+1)\nplot(plot_linestyle.price,"Ordinary name")';
 for(const version of [5,6]) await both(body,{"Nested field":closes,"Scalar field":[5,5,5],"Ordinary name":[11,21,31]},version);
});

test("primitive variable box coexists with genuine built-in box namespace in both versions",async()=>{
 const body='int box=7\ndrawn=box.new(bar_index,close+2,bar_index+1,close-2)\nplot(box,"Primitive")\nplot(box.get_top(drawn),"Drawing top")';
 for(const version of [5,6]) await both(body,{Primitive:[7,7,7],"Drawing top":[12,22,32]},version);
});

test("v5 local UDT namespace shadows end at their lexical scope",async()=>{
 const body=cell+'read(float value)=>\n    Cell box=Cell.new(value+100)\n    box.price\ndrawn=box.new(bar_index,close+2,bar_index+1,close-2)\nplot(read(close),"Local")\nplot(box.get_top(drawn),"Native after local")';
 await both(body,{Local:[110,120,130],"Native after local":[12,22,32]});
});

const compileFailure=error=>{
 assert.equal(error.code,"COMPILE_ERROR");
 assert.match(error.message,/namespace|shadow|obscur/i);
 return true;
};
test("v6 rejects inferred typed and alias UDT namespace variables during prepare and run",async()=>{
 for(const name of ["box","ta","math","syminfo"])for(const declaration of [
  name+"=Cell.new(close)","Cell "+name+"=Cell.new(close)",
  "current=Cell.new(close)\n"+name+"=current",
 ]){
  const body=cell+declaration+'\nplot(1,"Unused")';
  for(const action of ["prepare","run"]) await assert.rejects(execute(body,{version:6,action}),compileFailure,name+" "+action);
 }
});

test("v6 rejects UDT namespace names in nested locals and typed parameters",async()=>{
 for(const body of [
  cell+'read(float value)=>\n    Cell box=Cell.new(value)\n    box.price\nplot(read(close))',
  cell+'read(Cell box)=>box.price\ncurrent=Cell.new(close)\nplot(read(current))',
  cell+'method read(Cell box)=>box.price\ncurrent=Cell.new(close)\nplot(current.read())',
  cell+'read(float value)=>\n    float result=value\n    if true\n        box=Cell.new(value)\n        result:=box.price\n    result\nplot(read(close))',
 ])for(const action of ["prepare","run"]) await assert.rejects(execute(body,{version:6,action}),compileFailure,action);
});

test("actual worker strategy ledger uses the v5 shadowed object method quantity",async()=>{
 const body=cell+'method quantity(Cell box)=>box.price\namount=input.int(2,"Quantity",minval=1)\nCell box=Cell.new(amount)\nif bar_index==0\n    strategy.entry("Shadow",strategy.long,qty=box.quantity())\nif bar_index==1\n    strategy.close("Shadow")\nplot(strategy.position_size,"Position")';
 const result=await execute(body,{inputs:{in_0:3},declaration:'strategy("Namespace quantity",initial_capital=10000)'});
 assert.deepEqual(workerValues(result,"Position"),[0,3,0]);
 assert.deepEqual(result.strategy.closedTrades.map(t=>[t.entry_id,t.entry_price,t.exit_price,t.size,t.profit]),[["Shadow",19,29,3,30]]);
 assert.equal(result.strategy.metrics.netprofit,30);
});

test("ordinary JavaScript engine input remains independent of Pine receiver annotations",async()=>{
 const result=await new PineTS(rawBars,"TEST","1").run(context=>{
  const {close}=context.data;
  const {plot}=context.core;
  const box={price:close};
  plot(box.price,"JavaScript price");
 });
 assert.deepEqual(rawValues(result,"JavaScript price"),closes);
});

test("v5 UDT collection iterator shadows box while v6 rejects that namespace binding",async()=>{
 const declarations=cell+'array<Cell> objects=array.from(Cell.new(close),Cell.new(close+1))\nfloat total=0\n';
 const shadowed=declarations+'for box in objects\n    total+=box.price\nplot(total,"Total")';
 const safe=declarations+'for current in objects\n    total+=current.price\nplot(total,"Total")';
 await both(shadowed,{Total:[21,41,61]},5);
 await both(safe,{Total:[21,41,61]},6);
 for(const action of ["prepare","run"]) await assert.rejects(execute(shadowed,{version:6,action}),compileFailure);
});

test("primitive iterator box retains the genuine native namespace after its scope",async()=>{
 const body='float total=0\nfor box in array.from(1,2,3)\n    total+=box\ndrawn=box.new(bar_index,close+2,bar_index+1,close-2)\nplot(total,"Sum")\nplot(box.get_top(drawn),"Drawing top")';
 for(const version of [5,6]) await both(body,{Sum:[6,6,6],"Drawing top":[12,22,32]},version);
});

test("v5 UDT input.price method does not invent input definitions during prepare or run",async()=>{
 for(const genuine of [false,true]){
  const body='type Cell\n    float value\nmethod price(Cell input,float fallback)=>input.value+fallback\n'+
   (genuine?'length=input.int(2,"Real input")\n':'')+
   'Cell input=Cell.new(close)\nplot(input.price('+ (genuine?'length':'3.0') +'),"Result")';
  const code=body;
  assert.deepEqual(rawValues(await rawRun(code),"Result"),genuine?[12,22,32]:[13,23,33]);
  const prepared=await execute(code,{action:"prepare"});
  assert.deepEqual(prepared.inputDefinitions.map(d=>({id:d.id,type:d.type,title:d.title})),
   genuine?[{id:"in_0",type:"int",title:"Real input"}]:[]);
  const result=await execute(code,{inputs:genuine?{in_0:7}:{}});
  assert.deepEqual(result.inputDefinitions,prepared.inputDefinitions);
  assert.deepEqual(workerValues(result,"Result"),genuine?[17,27,37]:[13,23,33]);
  assert.deepEqual(result.inputs,genuine?{in_0:7}:{});
  assert.equal(result.source,source(code));
 }
});

test("v5 primitive range iterator does not inherit the outer UDT namespace receiver",async()=>{
 const body=cell+'Cell box=Cell.new(close)\nfloat result=0\nfor box=0 to 0\n    drawn=box.new(bar_index,close+1,bar_index+1,close-1)\n    result:=box.get_top(drawn)\nplot(result,"Native range")\nplot(box.price,"Outer object")';
 const prepared=await execute(body,{action:"prepare"});
 assert.deepEqual(prepared.inputDefinitions,[]);
 await both(body,{"Native range":[11,21,31],"Outer object":closes},5);
});
