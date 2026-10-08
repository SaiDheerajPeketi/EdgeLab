import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {build} from "esbuild";
import {createPineEnginePlugin} from "../../scripts/pine-engine.mjs";

// Genuine runtime failures must not print a complete minified data URL.
Error.stackTraceLimit=0;
const root=new URL("../../",import.meta.url).pathname;
const bundle=(await build({bundle:true,minify:true,format:"esm",platform:"browser",write:false,
 logLevel:"silent",plugins:[createPineEnginePlugin()],stdin:{loader:"ts",resolveDir:root,
 sourcefile:"pine-primitive-shadowing101.ts",
 contents:'export {PineTS,Indicator} from "pinets";export * from "./frontend/src/workers/pineNative.worker.ts";'
 }})).outputFiles[0].text;
console.info("PRIMITIVE101_BINDING "+JSON.stringify({minify:true,sealed:true,
 bundleSha256:createHash("sha256").update(bundle).digest("hex"),
 manifestSha256:createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json",import.meta.url))).digest("hex")}));
const {PineTS,Indicator,executePineRequest}=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const closes=[10,20,30,40,50,60];
const rawBars=closes.map((close,index)=>({openTime:1700000000000+index*60000,closeTime:Date.now()+3600000,open:close-1,high:close+2,low:close-2,close,volume:10}));
const bars=rawBars.map(b=>({time:b.openTime/1000,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume}));
const source=(body,version=6,declaration='indicator("Primitive101")')=>"//@version="+version+"\n"+declaration+"\n"+body;
const execute=(body,{version=6,inputs={},action="run",declaration}={})=>executePineRequest({id:"primitive101",action,source:source(body,version,declaration),inputs,
 ...(action==="run"?{bars,context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1}}:{})});
const rawRun=(body,version=6)=>new PineTS(rawBars,"TEST","1").run(new Indicator(source(body,version)));
const rawValues=(r,name)=>r.plots[name]?.data.map(p=>Number.isNaN(p.value)?null:p.value);
const workerValues=(r,name)=>r.plots.find(p=>p.name===name)?.points.map(p=>p.value);
const cell="type Cell\n    float price\n";
const enums='enum Side\n    a="Same"\n    b="Same"\nenum Other\n    a="Same"\n    b="Same"\n';
const fill=value=>Array(6).fill(value);
async function both(body,expected,version=6){
 const prepared=await execute(body,{version,action:"prepare"});assert.equal(prepared.source,source(body,version));
 const raw=await rawRun(body,version),worker=await execute(body,{version});
 assert.deepEqual(worker.inputDefinitions,prepared.inputDefinitions);
 for(const [name,values] of Object.entries(expected)){
  assert.deepEqual(rawValues(raw,name),values,"raw "+name);
  assert.deepEqual(workerValues(worker,name),values,"worker "+name);
 }
 assert.equal(worker.source,source(body,version));
}

// Official namespaces remain accessible when a primitive variable shares their name.
// https://www.tradingview.com/pine-script-docs/language/variable-declarations/#shadowing
// Custom methods support primitive receivers.
// https://www.tradingview.com/pine-script-docs/language/methods/#method-overloading
const primitiveMethods='method audit(int self)=>100+self\nmethod audit(float self)=>200+self\nmethod audit(bool self)=>self?300:301\nmethod audit(color self)=>400+color.r(self)\nmethod audit(string self)=>500+str.length(self)\n';

test("all five primitive types named as namespaces execute custom-only member bodies",async()=>{
 const body=primitiveMethods+'int math=2\nfloat box=close\nbool barstate=false\ncolor color=color.rgb(10,20,30)\nstring str="xy"\nplot(math.audit(),"Int")\nplot(box.audit(),"Float")\nplot(barstate.audit(),"Bool")\nplot(color.audit(),"Color")\nplot(str.audit(),"String")\nplot(math.abs(-close),"Native math")\ndrawn=box.new(bar_index,close+2,bar_index+1,close-2)\nplot(box.get_top(drawn),"Native box")\nplot(barstate.isfirst?1:0,"Native first")\nplot(color.r(color),"Native color")\nplot(str.length(str),"Native string")';
 for(const version of [5,6])await both(body,{Int:fill(102),Float:closes.map(x=>200+x),Bool:fill(301),Color:fill(410),String:fill(502),"Native math":closes,"Native box":closes.map(x=>x+2),"Native first":[1,0,0,0,0,0],"Native color":fill(10),"Native string":fill(2)},version);
});

test("inferred namespace receivers and aliases retain their own primitive values",async()=>{
 const body=primitiveMethods+'math=close\nbox=close*2\nstr="abc"\ncolor=color.rgb(11,22,33)\nbarstate=close>20\ncurrent=math\nplot(math.audit(),"Math")\nplot(box.audit(),"Box")\nplot(str.audit(),"String")\nplot(color.audit(),"Color")\nplot(barstate.audit(),"Bool")\nplot(current.audit(),"Alias")\nplot(math,"Stored math")\nplot(box,"Stored box")';
 for(const version of [5,6])await both(body,{Math:closes.map(x=>200+x),Box:closes.map(x=>200+x*2),String:fill(503),Color:fill(411),Bool:[301,301,300,300,300,300],Alias:closes.map(x=>200+x),"Stored math":closes,"Stored box":closes.map(x=>x*2)},version);
});

test("ta array and input receivers distinguish custom members from actual namespace functions",async()=>{
 const body=primitiveMethods+'float ta=close\nstring array="abc"\nfloat input=close\nlength=input.int(3,"Length")\narray<float> values=array.from(close,close+2)\nplot(ta.audit(),"TA custom")\nplot(array.audit(),"Array custom")\nplot(input.audit(),"Input custom")\nplot(ta.sma(close,1),"Native TA")\nplot(array.get(values,1),"Native array")\nplot(length,"Native input")';
 for(const version of [5,6]){
  await both(body,{"TA custom":closes.map(x=>200+x),"Array custom":fill(503),"Input custom":closes.map(x=>200+x),"Native TA":closes,"Native array":closes.map(x=>x+2),"Native input":fill(3)},version);
  const prepared=await execute(body,{version,action:"prepare"});
  assert.deepEqual(prepared.inputDefinitions.map(d=>({id:d.id,type:d.type,title:d.title,defval:d.defval})),[{id:"in_0",type:"int",title:"Length",defval:3}]);
 }
});

test("typed namespace-named function and method formals preserve lexical primitive receivers",async()=>{
 const body=primitiveMethods+'method auditFormal(float math)=>100+math\nreadMath(float math)=>math.audit()+math.abs(-math)\nreadBox(float box)=>\n    native=box.new(bar_index,box+2,bar_index+1,box-2)\n    box.audit()+box.get_top(native)\nreadColor(color color)=>color.audit()+color.r(color)\nreadString(string str)=>str.audit()+str.length(str)\nreadBool(bool barstate)=>barstate.audit()+(barstate.isfirst?1:0)\nfloat math=close*10\nplot(readMath(close),"Math formal")\nplot(readBox(close),"Box formal")\nplot(readColor(color.rgb(10,20,30)),"Color formal")\nplot(readString("xy"),"String formal")\nplot(readBool(false),"Bool formal")\nplot(math.auditFormal(),"Method formal")\nplot(math.audit(),"Global math")';
 for(const version of [5,6])await both(body,{"Math formal":closes.map(x=>200+x*2),"Box formal":closes.map(x=>202+x*2),"Color formal":fill(420),"String formal":fill(504),"Bool formal":[302,301,301,301,301,301],"Method formal":closes.map(x=>100+x*10),"Global math":closes.map(x=>200+x*10)},version);
});

test("nested lexical namespace shadows and aliases do not change the outer receiver",async()=>{
 const body=primitiveMethods+'float math=close\nfloat localValue=0.0\nfloat aliasValue=0.0\nif bar_index>=0\n    float math=close+1\n    alias=math\n    aliasValue:=alias.audit()\n    if bar_index>=0\n        float math=close+2\n        localValue:=math.audit()\nplot(math.audit(),"Outer")\nplot(aliasValue,"Local alias")\nplot(localValue,"Nested")\nplot(math.abs(-close),"Native")';
 for(const version of [5,6])await both(body,{Outer:closes.map(x=>200+x),"Local alias":closes.map(x=>201+x),Nested:closes.map(x=>202+x),Native:closes},version);
});

test("namespace-named locals in wrappers and conditional scopes execute the selected method",async()=>{
 const body=primitiveMethods+'read(float value)=>\n    float math=value\n    float box=value+1\n    math.audit()+box.audit()\nfloat conditional=0.0\nif close>=10\n    string str="xy"\n    color color=color.rgb(10,20,30)\n    bool barstate=false\n    conditional:=str.audit()+color.audit()+barstate.audit()\nplot(read(close),"Locals")\nplot(conditional,"Conditional")';
 for(const version of [5,6])await both(body,{Locals:closes.map(x=>401+x*2),Conditional:fill(1213)},version);
});

test("argument overloads named arguments defaults and declaration order select distinct bodies",async()=>{
 const declarations=['method score(float self,int value,int extra=3)=>100+self+value*10+extra','method score(float self,float value,float extra=4.5)=>200+self+value*10+extra'];
 for(const version of [5,6])for(const reversed of [false,true]){
  const body=(reversed?[...declarations].reverse():declarations).join("\n")+'\nfloat math=close\nfloat box=close\nplot(math.score(2),"Int default")\nplot(box.score(2.5),"Float default")\nplot(math.score(extra=7,value=2),"Int named")\nplot(box.score(2.5,extra=8.5),"Float mixed")';
  await both(body,{"Int default":closes.map(x=>x+123),"Float default":closes.map(x=>x+229.5),"Int named":closes.map(x=>x+127),"Float mixed":closes.map(x=>x+233.5)},version);
 }
});

test("generic wrappers with namespace-named parameters specialize each actual primitive signature",async()=>{
 const body=primitiveMethods+'relay(math)=>math.audit()\nchain(box)=>relay(box)\nfloat ta=close\nint array=2\nstring input="xy"\nplot(chain(ta),"Float")\nplot(chain(array),"Int")\nplot(chain(input),"String")\nplot(chain(false),"Bool")\nplot(chain(color.rgb(10,20,30)),"Color")';
 for(const version of [5,6])await both(body,{Float:closes.map(x=>200+x),Int:fill(102),String:fill(502),Bool:fill(301),Color:fill(410)},version);
});

test("namespace receiver parameter history stays independent across written calls and wrappers",async()=>{
 const body='method prior(float self)=>100+nz(self[1],0)\nrelay(float math)=>math.prior()\nfloat math=close\nfloat box=close*2\nplot(math.prior(),"Direct A")\nplot(box.prior(),"Direct B")\nplot(relay(close),"Wrapper A")\nplot(relay(close*2),"Wrapper B")';
 for(const version of [5,6])await both(body,{"Direct A":[100,110,120,130,140,150],"Direct B":[100,120,140,160,180,200],"Wrapper A":[100,110,120,130,140,150],"Wrapper B":[100,120,140,160,180,200]},version);
});

test("each written namespace receiver call owns its persistent method locals",async()=>{
 const body='method tally(float self,int step)=>\n    var int total=0\n    total+=step\n    total\nfloat math=close\nfloat input=close\nplot(math.tally(1),"A")\nplot(math.tally(2),"B")\nplot(input.tally(3),"C")';
 for(const version of [5,6])await both(body,{A:[1,2,3,4,5,6],B:[2,4,6,8,10,12],C:[3,6,9,12,15,18]},version);
});

test("enum signatures and saved input overrides keep exact IDs without invented custom input controls",async()=>{
 const body='enum Side\n    up="Same"\n    down="Same"\nenum Other\n    up="Same"\n    down="Same"\nmethod choose(float self,Side value)=>self+(value==Side.up?11:12)\nmethod choose(float self,Other value)=>self+(value==Other.up?21:22)\nmethod add(float self,int value)=>self+value\nside=input.enum(Side.up,"Side")\nlength=input.int(3,"Length")\nfloat input=close\nplot(input.choose(side),"Saved enum")\nplot(input.choose(Other.down),"Other enum")\nplot(input.add(length),"Saved int")';
 for(const version of [5,6]){
  await both(body,{"Saved enum":closes.map(x=>x+11),"Other enum":closes.map(x=>x+22),"Saved int":closes.map(x=>x+3)},version);
  const prepared=await execute(body,{version,action:"prepare"});
  assert.deepEqual(prepared.inputDefinitions.map(d=>({id:d.id,type:d.type,title:d.title,defval:d.defval})),[{id:"in_0",type:"enum",title:"Side",defval:"Side.up"},{id:"in_1",type:"int",title:"Length",defval:3}]);
  const inputs={in_0:"Side.down",in_1:7},result=await execute(body,{version,inputs});
  assert.deepEqual(result.inputDefinitions,prepared.inputDefinitions);assert.deepEqual(result.inputs,inputs);assert.equal(result.source,source(body,version));
  assert.deepEqual(workerValues(result,"Saved enum"),closes.map(x=>x+12));assert.deepEqual(workerValues(result,"Other enum"),closes.map(x=>x+22));assert.deepEqual(workerValues(result,"Saved int"),closes.map(x=>x+7));
 }
});

test("genuine native members take priority even when a primitive custom signature could match",async()=>{
 const body='method abs(float self,float value)=>9999.0\nmethod r(color self,color value)=>9999.0\nmethod length(string self,string value)=>9999\nmethod get(float self,array<float> values,int index)=>9999.0\nfloat math=close\ncolor color=color.rgb(10,20,30)\nstring str="xy"\nfloat array=close\narray<float> values=array.from(close,close+2)\nplot(math.abs(-close),"Math")\nplot(color.r(color.rgb(5,6,7)),"Color")\nplot(str.length("abc"),"String")\nplot(array.get(values,1),"Array")';
 for(const version of [5,6])await both(body,{Math:closes,Color:fill(5),String:fill(3),Array:closes.map(x=>x+2)},version);
});

test("internal engine param helpers do not reserve an authored custom method member",async()=>{
 const body='method param(float self,int extra=2)=>100+self+extra\nfloat math=close\nfloat ta=close\nfloat input=close\nlength=input.int(3,"Length")\nplot(math.param(),"Math")\nplot(ta.param(extra=4),"TA")\nplot(input.param(length),"Input")\nplot(math.abs(-close),"Native")';
 for(const version of [5,6]){
  await both(body,{Math:closes.map(x=>x+102),TA:closes.map(x=>x+104),Input:closes.map(x=>x+103),Native:closes},version);
  const prepared=await execute(body,{version,action:"prepare"});
  assert.deepEqual(prepared.inputDefinitions.map(d=>[d.id,d.title]),[["in_0","Length"]]);
  const result=await execute(body,{version,inputs:{in_0:7}});assert.deepEqual(workerValues(result,"Input"),closes.map(x=>x+107));
 }
});

test("wrong primitive receiver argument type arity and named arguments reject at prepare and run",async()=>{
 const method='method audit(float self,int amount,int extra=3)=>self+amount+extra\n';
 const invalid=[
  method+'bool math=false\nplot(math.audit(2),"Invalid")',
  method+'float math=close\nplot(math.audit("wrong"),"Invalid")',
  method+'float math=close\nplot(math.audit(),"Invalid")',
  method+'float math=close\nplot(math.audit(2,3,4),"Invalid")',
  method+'float math=close\nplot(math.audit(unknown=2),"Invalid")',
  method+'float math=close\nplot(math.audit(2,amount=3),"Invalid")'
 ];
 for(const version of [5,6])for(const body of invalid)for(const action of ["prepare","run"])await assert.rejects(execute(body,{version,action}),error=>{
  assert.equal(error.code,"COMPILE_ERROR");assert.match(error.message,/method|receiver|overload|argument|parameter|type|unknown|duplicate|required/i);return true;
 });
});

test("xloc and yloc primitive receivers preserve native coordinate constants and drawing coordinates",async()=>{
 const body='method tag(int self)=>self+2\nint xloc=7\nint yloc=7\nplot(xloc.tag(),"X custom")\nplot(yloc.tag(),"Y custom")\nplot(xloc.bar_index=="bi"?1:0,"X native")\nplot(yloc.price=="pr"?1:0,"Y native")\ndrawn=line.new(bar_index,close,bar_index+1,close+2,xloc=xloc.bar_index)\nmarked=label.new(bar_index,close,"Price",xloc=xloc.bar_index,yloc=yloc.price)\nplot(line.get_x1(drawn),"Line index")\nplot(label.get_y(marked),"Label price")';
 for(const version of [5,6])await both(body,{"X custom":fill(9),"Y custom":fill(9),"X native":fill(1),"Y native":fill(1),"Line index":[0,1,2,3,4,5],"Label price":closes},version);
});

test("xloc and yloc UDT variables support v5 object methods but reject as namespace shadows in v6",async()=>{
 for(const name of ["xloc","yloc"]){
  const body='type Cell\n    float price\nmethod tag(Cell self)=>self.price+2\n'+name+'=Cell.new(close)\nplot('+name+'.tag(),"Custom")';
  await both(body,{Custom:closes.map(x=>x+2)},5);
  for(const action of ["prepare","run"])await assert.rejects(execute(body,{version:6,action}),error=>{
   assert.equal(error.code,"COMPILE_ERROR");assert.match(error.message,/v6.*UDT.*(?:xloc|yloc).*namespace/i);return true;
  });
 }
});
