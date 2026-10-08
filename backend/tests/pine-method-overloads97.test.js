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
 sourcefile:"pine-method-overloads97.ts",
 contents:'export {PineTS,Indicator} from "pinets";export * from "./frontend/src/workers/pineNative.worker.ts";'
 }})).outputFiles[0].text;
console.info("METHOD97_BINDING "+JSON.stringify({minify:true,sealed:true,
 bundleSha256:createHash("sha256").update(bundle).digest("hex"),
 manifestSha256:createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json",import.meta.url))).digest("hex")}));
const {PineTS,Indicator,executePineRequest}=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const closes=[10,20,30,40,50,60];
const rawBars=closes.map((close,index)=>({openTime:1700000000000+index*60000,closeTime:Date.now()+3600000,open:close-1,high:close+2,low:close-2,close,volume:10}));
const bars=rawBars.map(b=>({time:b.openTime/1000,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume}));
const source=(body,version=6,declaration='indicator("Methods97")')=>"//@version="+version+"\n"+declaration+"\n"+body;
const execute=(body,{version=6,inputs={},action="run",declaration}={})=>executePineRequest({id:"methods97",action,source:source(body,version,declaration),inputs,
 ...(action==="run"?{bars,context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1}}:{})});
const rawRun=(body,version=6)=>new PineTS(rawBars,"TEST","1").run(new Indicator(source(body,version)));
const rawValues=(r,name)=>r.plots[name]?.data.map(p=>Number.isNaN(p.value)?null:p.value);
const workerValues=(r,name)=>r.plots.find(p=>p.name===name)?.points.map(p=>p.value);
const cell="type Cell\n    float price\n";
const enums='enum Side\n    a="Same"\n    b="Same"\nenum Other\n    a="Same"\n    b="Same"\n';
const fill=value=>Array(6).fill(value);
async function both(body,expected,version=6){
 const raw=await rawRun(body,version),worker=await execute(body,{version});
 for(const [name,values] of Object.entries(expected)){
  assert.deepEqual(rawValues(raw,name),values,"raw "+name);
  assert.deepEqual(workerValues(worker,name),values,"worker "+name);
 }
 assert.equal(worker.source,source(body,version));
}
// Primary contract: actual signatures select bodies; native methods remain usable.
// https://www.tradingview.com/pine-script-docs/language/methods/#method-overloading

test("same receiver int and float methods execute distinct bodies independently of declaration and call order",async()=>{
 const declarations=['method select(Cell self,int value)=>100+self.price+value','method select(Cell self,float value)=>200+self.price+value'];
 const calls=['plot(current.select(2),"Int")','plot(current.select(2.5),"Float")'];
 for(const version of [5,6])for(const reversed of [false,true]){
  const body=cell+(reversed?[...declarations].reverse():declarations).join("\n")+'\ncurrent=Cell.new(close)\n'+(reversed?[...calls].reverse():calls).join("\n");
  await both(body,{Int:closes.map(v=>v+102),Float:closes.map(v=>v+202.5)},version);
 }
});

test("integer actual arguments widen to a float method only when no exact integer signature exists",async()=>{
 const body=cell+'method select(Cell self,float value)=>200+self.price+value\ncurrent=Cell.new(close)\nplot(current.select(2),"Widened")\nplot(current.select(2.5),"Exact")';
 for(const version of [5,6])await both(body,{Widened:closes.map(v=>v+202),Exact:closes.map(v=>v+202.5)},version);
});

test("same-title enum members select the correct distinct method signature and body",async()=>{
 const body=cell+enums+'method choose(Cell self,Side value)=>self.price+(value==Side.a?11:12)\nmethod choose(Cell self,Other value)=>self.price+(value==Other.a?21:22)\ncurrent=Cell.new(close)\nplot(current.choose(Side.a),"Side A")\nplot(current.choose(Side.b),"Side B")\nplot(current.choose(Other.a),"Other A")\nplot(current.choose(Other.b),"Other B")';
 for(const version of [5,6])await both(body,{"Side A":closes.map(v=>v+11),"Side B":closes.map(v=>v+12),"Other A":closes.map(v=>v+21),"Other B":closes.map(v=>v+22)},version);
});

test("collection element types distinguish same receiver method signatures",async()=>{
 const body=cell+enums+'method read(Cell self,array<int> values)=>100+self.price+array.get(values,0)\nmethod read(Cell self,array<float> values)=>200+self.price+array.get(values,0)\nmethod read(Cell self,array<Side> values)=>array.get(values,0)==Side.a?44:45\nmethod read(Cell self,array<Other> values)=>array.get(values,0)==Other.a?55:56\ncurrent=Cell.new(close)\narray<int> ints=array.from(2)\narray<float> floats=array.from(2.5)\narray<Side> sides=array.from(Side.a)\narray<Other> others=array.from(Other.a)\nplot(current.read(ints),"Ints")\nplot(current.read(floats),"Floats")\nplot(current.read(sides),"Sides")\nplot(current.read(others),"Others")';
 for(const version of [5,6])await both(body,{Ints:closes.map(v=>v+102),Floats:closes.map(v=>v+202.5),Sides:fill(44),Others:fill(55)},version);
});

test("named mixed and default arguments bind the selected method parameters in declaration order",async()=>{
 const body=cell+'method score(Cell self,int value,int extra=3)=>100+self.price+value*10+extra\nmethod score(Cell self,bool condition,int fallback=5)=>self.price+(condition?200:300)+fallback\ncurrent=Cell.new(close)\nplot(current.score(2),"Default")\nplot(current.score(extra=4,value=2),"Named")\nplot(current.score(2,extra=5),"Mixed")\nplot(current.score(condition=false),"Bool default")\nplot(current.score(fallback=7,condition=true),"Bool named")';
 for(const version of [5,6])await both(body,{Default:closes.map(v=>v+123),Named:closes.map(v=>v+124),Mixed:closes.map(v=>v+125),"Bool default":closes.map(v=>v+305),"Bool named":closes.map(v=>v+207)},version);
});

test("ordinary functions with the same identifier remain separate from overloaded methods",async()=>{
 const body=cell+'choose(int value)=>300+value\nchoose(bool value)=>value?400:500\nmethod choose(Cell self,int value)=>100+self.price+value\nmethod choose(Cell self,bool value)=>self.price+(value?200:250)\ncurrent=Cell.new(close)\nplot(choose(2),"Function int")\nplot(choose(false),"Function bool")\nplot(current.choose(2),"Method int")\nplot(current.choose(false),"Method bool")';
 for(const version of [5,6])await both(body,{"Function int":fill(302),"Function bool":fill(500),"Method int":closes.map(v=>v+102),"Method bool":closes.map(v=>v+250)},version);
});

test("different receiver types retain all of their distinct argument overloads",async()=>{
 const body=cell+'type OtherCell\n    float price\nmethod select(Cell self,int value)=>100+self.price+value\nmethod select(Cell self,float value)=>200+self.price+value\nmethod select(OtherCell self,int value)=>300+self.price+value\nmethod select(OtherCell self,float value)=>400+self.price+value\none=Cell.new(close)\ntwo=OtherCell.new(close)\nplot(one.select(2),"Cell int")\nplot(one.select(2.5),"Cell float")\nplot(two.select(2),"Other int")\nplot(two.select(2.5),"Other float")';
 for(const version of [5,6])await both(body,{"Cell int":closes.map(v=>v+102),"Cell float":closes.map(v=>v+202.5),"Other int":closes.map(v=>v+302),"Other float":closes.map(v=>v+402.5)},version);
});

test("generic nested wrappers select methods from each known receiver and argument signature",async()=>{
 const body=cell+enums+'method choose(Cell self,int value)=>100+self.price+value\nmethod choose(Cell self,float value)=>200+self.price+value\nmethod choose(Cell self,Side value)=>self.price+(value==Side.a?11:12)\nrelay(receiver,value)=>receiver.choose(value)\nchain(receiver,value)=>relay(receiver,value)\ncurrent=Cell.new(close)\nplot(chain(current,2),"Int")\nplot(chain(current,2.5),"Float")\nplot(chain(current,Side.b),"Enum")';
 for(const version of [5,6])await both(body,{Int:closes.map(v=>v+102),Float:closes.map(v=>v+202.5),Enum:closes.map(v=>v+12)},version);
});

test("each written overloaded method call owns independent persistent locals",async()=>{
 const body=cell+'method tally(Cell self,int step)=>\n    var int total=0\n    total+=step\n    total\nmethod tally(Cell self,float step)=>\n    var float total=100.0\n    total+=step\n    total\ncurrent=Cell.new(close)\nplot(current.tally(1),"Int A")\nplot(current.tally(2),"Int B")\nplot(current.tally(0.5),"Float A")\nplot(current.tally(1.0),"Float B")';
 await both(body,{"Int A":[1,2,3,4,5,6],"Int B":[2,4,6,8,10,12],"Float A":[100.5,101,101.5,102,102.5,103],"Float B":[101,102,103,104,105,106]});
});

test("method parameter history stays separate across signatures and sibling written calls",async()=>{
 const body=cell+'method prior(Cell self,int value)=>nz(value[1],0)+100\nmethod prior(Cell self,float value)=>nz(value[1],0)+200\ncurrent=Cell.new(close)\nplot(current.prior(bar_index),"Index")\nplot(current.prior(close),"Price")\nplot(current.prior(close*2),"Twice price")';
 await both(body,{Index:[100,100,101,102,103,104],Price:[200,210,220,230,240,250],"Twice price":[200,220,240,260,280,300]});
});

test("methods returned directly from typed wrappers retain their call history",async()=>{
 const body=cell+'method prior(Cell self,int value)=>nz(value[1],0)+100\nmethod prior(Cell self,float value)=>nz(value[1],0)+200\nrelay(Cell receiver,int value)=>receiver.prior(value)\nrelay(Cell receiver,float value)=>receiver.prior(value)\ncurrent=Cell.new(close)\nplot(relay(current,bar_index),"Index")\nplot(relay(current,close),"Price")\nplot(relay(current,close*2),"Twice price")';
 await both(body,{Index:[100,100,101,102,103,104],Price:[200,210,220,230,240,250],"Twice price":[200,220,240,260,280,300]});
});

test("returned UDT receivers chain into the next correctly selected method",async()=>{
 const body=cell+'method identity(Cell self,int value)=>self\nmethod identity(Cell self,float value)=>Cell.new(self.price+100)\nmethod read(Cell self,int value)=>self.price+value\nmethod read(Cell self,float value)=>self.price+value+200\ncurrent=Cell.new(close)\nplot(current.identity(1).read(2),"Int chain")\nplot(current.identity(1.0).read(2.0),"Float chain")\nplot(current.price,"Original")';
 for(const version of [5,6])await both(body,{"Int chain":closes.map(v=>v+2),"Float chain":closes.map(v=>v+302),Original:closes},version);
});

test("prepared saved custom input IDs and enum identities drive the actual selected runtime methods",async()=>{
 const body=cell+enums+'method choose(Cell self,int value)=>100+self.price+value\nmethod choose(Cell self,float value)=>200+self.price+value\nmethod choose(Cell self,Side value)=>self.price+(value==Side.a?11:22)\nside=input.enum(Side.a,"Side")\namount=input.float(2.5,"Amount")\nstep=input.int(3,"Step")\ncurrent=Cell.new(close)\nplot(current.choose(side),"Enum")\nplot(current.choose(amount),"Float")\nplot(current.choose(step),"Int")';
 for(const version of [5,6]){
  const prepared=await execute(body,{version,action:"prepare"});
  assert.deepEqual(prepared.inputDefinitions.map(d=>({id:d.id,type:d.type,title:d.title,defval:d.defval})),[
   {id:"in_0",type:"enum",title:"Side",defval:"Side.a"},{id:"in_1",type:"float",title:"Amount",defval:2.5},{id:"in_2",type:"int",title:"Step",defval:3}]);
  const saved={in_0:"Side.b",in_1:4.5,in_2:7};
  const result=await execute(body,{version,inputs:saved});
  assert.deepEqual(result.inputs,saved); assert.deepEqual(result.inputDefinitions,prepared.inputDefinitions);
  assert.deepEqual(workerValues(result,"Enum"),closes.map(v=>v+22));
  assert.deepEqual(workerValues(result,"Float"),closes.map(v=>v+204.5));
  assert.deepEqual(workerValues(result,"Int"),closes.map(v=>v+107));
  assert.equal(result.source,source(body,version));
 }
});

test("actual worker orders and closed trade ledger use overloaded method quantities",async()=>{
 const body=cell+enums+'method quantity(Cell self,int value)=>value\nmethod quantity(Cell self,Side value)=>value==Side.a?2:5\nchoice=input.enum(Side.a,"Quantity side")\ncurrent=Cell.new(close)\nif bar_index==0\n    strategy.entry("Enum",strategy.long,qty=current.quantity(choice))\nif bar_index==1\n    strategy.close("Enum")\nif bar_index==3\n    strategy.entry("Int",strategy.long,qty=current.quantity(2))\nif bar_index==4\n    strategy.close("Int")\nplot(strategy.position_size,"Position")';
 for(const version of [5,6]){
  const result=await execute(body,{version,inputs:{in_0:"Side.b"},declaration:'strategy("Method quantities",initial_capital=10000)'});
  assert.deepEqual(workerValues(result,"Position"),[0,5,0,0,2,0]);
  assert.deepEqual(result.strategy.closedTrades.map(t=>[t.entry_id,t.entry_price,t.exit_price,t.size,t.profit]),[["Enum",19,29,5,50],["Int",49,59,2,20]]);
  assert.equal(result.strategy.metrics.netprofit,70);assert.equal(result.strategy.metrics.equity,10070);
 }
});

test("custom array fill overload and genuine built-in fill retain their different signatures",async()=>{
 const body='method fill(array<float> self,float inner,float outer,float lower,float upper)=>\n    for [index,value] in self\n        array.set(self,index,value>=lower and value<=upper?inner:outer)\n    self\narray<float> values=array.from(1.0,3.0,5.0)\nnative=values.copy()\nfiltered=values.copy()\nnative.fill(9.0)\nfiltered.fill(1.0,0.0,2.0,4.0)\nplot(array.sum(native),"Native")\nplot(array.sum(filtered),"Custom")\nplot(array.sum(values),"Original")';
 for(const version of [5,6])await both(body,{Native:fill(27),Custom:fill(1),Original:fill(9)},version);
});

test("primitive receiver overloads coexist with genuine math and box namespaces",async()=>{
 const body='method tag(int self)=>100+self\nmethod tag(float self)=>200+self\nmethod tag(bool self)=>self?300:301\nmethod tag(color self)=>400+color.r(self)\nmethod tag(string self)=>500+str.length(self)\ni=2\nf=2.5\nb=false\nc=color.rgb(10,20,30)\ns="x"\ndrawn=box.new(bar_index,close+2,bar_index+1,close-2)\nplot(i.tag(),"Int")\nplot(f.tag(),"Float")\nplot(b.tag(),"Bool")\nplot(c.tag(),"Color")\nplot(s.tag(),"String")\nplot(math.abs(-close),"Math")\nplot(box.get_top(drawn),"Box")';
 for(const version of [5,6])await both(body,{Int:fill(102),Float:fill(202.5),Bool:fill(301),Color:fill(410),String:fill(501),Math:closes,Box:closes.map(v=>v+2)},version);
});

const compileFailure=error=>{assert.equal(error.code,"COMPILE_ERROR");assert.match(error.message,/method|overload|argument|parameter|ambiguous|type|unknown|duplicate/i);return true;};
test("ambiguous na unresolved and foreign argument types reject during prepare and run",async()=>{
 const declarations=cell+enums+'method select(Cell self,int value)=>11\nmethod select(Cell self,float value)=>22\ncurrent=Cell.new(close)\n';
 for(const call of ['current.select(na)','current.select(unknown_value)','current.select("wrong")','current.select(Side.a)'])
  for(const action of ["prepare","run"])await assert.rejects(execute(declarations+'plot('+call+',"Invalid")',{action}),compileFailure,call+" "+action);
 await both(declarations+'plot(current.select(int(na)),"Typed int")\nplot(current.select(float(na)),"Typed float")',{"Typed int":fill(11),"Typed float":fill(22)});
});

test("invalid duplicate signatures arity and named binding reject instead of choosing a method body",async()=>{
 for(const definitions of [
  'method invalid(Cell self,int value)=>11\nmethod invalid(Cell self,int renamed)=>22',
  'method invalid(Cell self,int value)=>11\nmethod invalid(Cell self,int value,int optional=1)=>22',
 ]){
  for(const action of ["prepare","run"])await assert.rejects(execute(cell+definitions+'\nplot(1,"Unused")',{action}),compileFailure);
 }
 const declarations=cell+'method select(Cell self,int value)=>11\nmethod select(Cell self,bool value)=>22\ncurrent=Cell.new(close)\n';
 for(const call of ['current.select()','current.select(1,2)','current.select(wrong=1)','current.select(value=1,value=2)','current.select(value=1,2)'])
  for(const action of ["prepare","run"])await assert.rejects(execute(declarations+'plot('+call+',"Invalid")',{action}),compileFailure,call);
});

test("custom array and map get signatures preserve explicit and instance builtin calls",async()=>{
 const body='method get(array<float> self,int index,bool custom)=>array.get(self,index)+100\nmethod get(map<string,float> self,string key,bool custom)=>map.get(self,key)+200\narray<float> values=array.from(3.0,4.0)\nmap<string,float> lookup=map.new<string,float>()\nmap.put(lookup,"price",7.0)\nplot(values.get(0),"Array native instance")\nplot(array.get(values,0),"Array native namespace")\nplot(values.get(0,true),"Array custom")\nplot(lookup.get("price"),"Map native instance")\nplot(map.get(lookup,"price"),"Map native namespace")\nplot(lookup.get("price",true),"Map custom")';
 for(const version of [5,6])await both(body,{"Array native instance":fill(3),"Array native namespace":fill(3),"Array custom":fill(103),"Map native instance":fill(7),"Map native namespace":fill(7),"Map custom":fill(207)},version);
});

test("collection-only user method mismatched receiver and enum types reject at compile time",async()=>{
 const declarations=enums+'method only(array<float> self,Side choice)=>array.sum(self)+(choice==Side.a?1:2)\narray<float> values=array.from(3.0)\narray<int> ints=array.from(3)\n';
 for(const call of ['values.only("wrong")','values.only(Other.a)','ints.only(Side.a)'])
  for(const action of ["prepare","run"])await assert.rejects(execute(declarations+'plot('+call+',"Invalid")',{action}),compileFailure,call);
});

test("typed enum na selects its declared method signature while bare na stays ambiguous",async()=>{
 const declarations=enums+'method choose(Side self,int count,Side value)=>11\nmethod choose(Side self,int count,Other value)=>22\n';
 for(const version of [5,6]){
  const body=declarations+'Side sideMissing=na\nOther otherMissing=na\nplot(Side.a.choose(3,sideMissing),"Side typed na")\nplot(Side.a.choose(3,otherMissing),"Other typed na")';
  await both(body,{"Side typed na":fill(11),"Other typed na":fill(22)},version);
  for(const action of ["prepare","run"])await assert.rejects(execute(declarations+'plot(Side.a.choose(3,na),"Invalid")',{version,action}),compileFailure);
 }
});
