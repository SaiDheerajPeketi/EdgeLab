import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {createHash} from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Runtime failures must not print the complete minified data URL.
Error.stackTraceLimit = 0;
const root = new URL("../../", import.meta.url).pathname;
const bundle = (await build({bundle:true,minify:true,format:"esm",platform:"browser",write:false,
 logLevel:"silent",plugins:[createPineEnginePlugin()],stdin:{
  contents:'export {PineTS,Indicator} from "pinets";export * from "./frontend/src/workers/pineNative.worker.ts";',
  loader:"ts",resolveDir:root,sourcefile:"pine-function-overloads94.ts"
 }})).outputFiles[0].text;
console.info("OVERLOAD94_BINDING "+JSON.stringify({minify:true,sealed:true,bundleSha256:createHash("sha256").update(bundle).digest("hex"),manifestSha256:createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json",import.meta.url))).digest("hex")}));
const {PineTS,Indicator,executePineRequest} = await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const closeValues=[10,20,30,40,50,60];
const rawBars=closeValues.map((close,index)=>({openTime:1700000000000+index*60000,closeTime:Date.now()+3600000,open:close-1,high:close+2,low:close-2,close,volume:10}));
const source=(body,version=6,declaration='indicator("Overloads94")')=>'//@version='+version+'\n'+declaration+'\n'+body;
const run=(body,version=6)=>new PineTS(rawBars,"TEST","1").run(new Indicator(source(body,version)));
const values=(result,title)=>result.plots[title].data.map(point=>Number.isNaN(point.value)?null:point.value);
const enums='enum Side\n    a="Same"\n    b="Same"\nenum Other\n    a="Same"\n    b="Same"\n';
test("ordinary enum overloads execute distinct bodies independently of declaration order",async()=>{
 for(const version of [5,6])for(const declarations of [
  'choose(Side value)=>11\nchoose(Other value)=>22',
  'choose(Other value)=>22\nchoose(Side value)=>11',
 ]){
  const result=await run(enums+declarations+'\nplot(choose(Side.a),"Side")\nplot(choose(Other.a),"Other")',version);
  assert.deepEqual({Side:values(result,"Side"),Other:values(result,"Other")},{Side:Array(6).fill(11),Other:Array(6).fill(22)});
 }
});

const candleBars=rawBars.map(bar=>({time:bar.openTime/1000,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume}));
const execute=(body,{version=6,inputs={},declaration='indicator("Overloads94")',action="run"}={})=>executePineRequest({id:"overloads94",action,source:source(body,version,declaration),inputs,
 ...(action==="run"?{bars:candleBars,context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1}}:{})});
const workerValues=(result,title)=>result.plots.find(plot=>plot.name===title).points.map(point=>point.value);
// Official required-type/count and written-call scope rules:
// https://www.tradingview.com/pine-script-docs/language/user-defined-functions/#function-overloading

test("official numeric boolean and color overload pattern executes all distinct operations",async()=>{
 const body='negate(float value)=>-value\nnegate(bool value)=>not value\nnegate(color value)=>color.rgb(255-color.r(value),255-color.g(value),255-color.b(value),color.t(value))\nplot(negate(close),"Numeric")\nplot(negate(false)?1:0,"Boolean")\nplot(color.r(negate(color.rgb(10,20,30))),"Color")';
 for(const version of [5,6]){
  const result=await run(body,version);
  assert.deepEqual(values(result,"Numeric"),closeValues.map(value=>-value));
  assert.deepEqual(values(result,"Boolean"),Array(6).fill(1));
  assert.deepEqual(values(result,"Color"),Array(6).fill(245));
 }
});

test("integer and float overloads dispatch literals inputs and chart series by actual static type",async()=>{
 const body='identify(int value)=>1000+value\nidentify(float value)=>2000+value\nlength=input.int(7,"Length")\nplot(identify(1),"Literal int")\nplot(identify(1.0),"Literal float")\nplot(identify(length),"Input int")\nplot(identify(bar_index),"Series int")\nplot(identify(close),"Series float")';
 for(const version of [5,6]){
  const result=await run(body,version);
  assert.deepEqual(values(result,"Literal int"),Array(6).fill(1001));
  assert.deepEqual(values(result,"Literal float"),Array(6).fill(2001));
  assert.deepEqual(values(result,"Input int"),Array(6).fill(1007));
  assert.deepEqual(values(result,"Series int"),closeValues.map((_,index)=>1000+index));
  assert.deepEqual(values(result,"Series float"),closeValues.map(value=>2000+value));
 }
});

test("required arity defaults and named or mixed argument binding select the distinct signature",async()=>{
 const body='score(int x)=>100+x\nscore(int x,int y,int z=3)=>200+x*10+y+z\nscore(bool condition,int fallback=5)=>condition?300+fallback:400+fallback\nplot(score(1),"One")\nplot(score(x=1),"Named one")\nplot(score(1,2),"Default")\nplot(score(y=2,x=1,z=4),"Reordered")\nplot(score(1,2,z=5),"Mixed")\nplot(score(condition=false),"Boolean default")';
 for(const version of [5,6]){
  const result=await run(body,version);
  for(const [name,expected] of [["One",101],["Named one",101],["Default",215],["Reordered",216],["Mixed",217],["Boolean default",405]])
   assert.deepEqual(values(result,name),Array(6).fill(expected),name);
 }
});

test("enum calls nested in typed wrappers preserve member identity and genuine input overrides",async()=>{
 const body=enums+'translate(Side value)=>value==Side.a?11:12\ntranslate(Other value)=>22\nrelay(Side value)=>translate(value)\nrelay(Other value)=>translate(value=value)\nchosen=input.enum(Side.a,"Choose")\nplot(relay(chosen),"Chosen")\nplot(relay(value=Other.a),"Other")';
 for(const version of [5,6]){
  const result=await execute(body,{version,inputs:{in_0:"Side.b"}});
  assert.deepEqual(workerValues(result,"Chosen"),Array(6).fill(12));
  assert.deepEqual(workerValues(result,"Other"),Array(6).fill(22));
  assert.equal(result.inputs.in_0,"Side.b");assert.equal(result.source,source(body,version));
 }
});

test("later overload may call a previously defined different overload without being recursive",async()=>{
 const body='negate(float value)=>-value\nnegate(bool value)=>not value\nnegate(float left,float right)=>negate(left*right)\nwrapper(float value)=>negate(value)\nplot(negate(2.0,3.0),"Product")\nplot(wrapper(close),"Wrapped")\nplot(negate(false)?1:0,"Boolean")';
 for(const version of [5,6]){
  const result=await run(body,version);
  assert.deepEqual(values(result,"Product"),Array(6).fill(-6));
  assert.deepEqual(values(result,"Wrapped"),closeValues.map(value=>-value));
  assert.deepEqual(values(result,"Boolean"),Array(6).fill(1));
 }
});

test("each written overload call owns independent persistent local state",async()=>{
 const body='tally(int step)=>\n    var int total=0\n    total+=step\n    total\ntally(float step)=>\n    var float total=100.0\n    total+=step\n    total\nplot(tally(1),"Int A")\nplot(tally(2),"Int B")\nplot(tally(1.0),"Float A")\nplot(tally(2.0),"Float B")';
 const result=await run(body);
 assert.deepEqual(values(result,"Int A"),[1,2,3,4,5,6]);
 assert.deepEqual(values(result,"Int B"),[2,4,6,8,10,12]);
 assert.deepEqual(values(result,"Float A"),[101,102,103,104,105,106]);
 assert.deepEqual(values(result,"Float B"),[102,104,106,108,110,112]);
});

test("history of each written overload parameter stays separate across sibling calls",async()=>{
 const body='prior(int value)=>nz(value[1],0)+100\nprior(float value)=>nz(value[1],0)+200\nplot(prior(bar_index),"Index history")\nplot(prior(close),"Price history")\nplot(prior(close*2),"Second price history")';
 const result=await run(body);
 assert.deepEqual(values(result,"Index history"),[100,100,101,102,103,104]);
 assert.deepEqual(values(result,"Price history"),[200,210,220,230,240,250]);
 assert.deepEqual(values(result,"Second price history"),[200,220,240,260,280,300]);
});

test("ordinary enum and UDT overloads coexist with built-in namespaces",async()=>{
 const body=enums+'type Box\n    float price\nresolve(Side value)=>11\nresolve(Other value)=>22\nresolve(Box value)=>value.price+100\nBox(Side value)=>55\nBox(Other value)=>66\nabs(Side value)=>33\nabs(Other value)=>44\nBox current=Box.new(close)\nplot(resolve(Side.a),"Side")\nplot(resolve(Other.a),"Other")\nplot(resolve(current),"UDT")\nplot(abs(Side.b),"Ordinary abs")\nplot(math.abs(-close),"Builtin abs")\nplot(Box(Side.a),"Type-name Side")\nplot(Box(Other.a),"Type-name Other")';
 const result=await run(body);
 assert.deepEqual(values(result,"Side"),Array(6).fill(11));assert.deepEqual(values(result,"Other"),Array(6).fill(22));
 assert.deepEqual(values(result,"UDT"),closeValues.map(value=>value+100));
 assert.deepEqual(values(result,"Ordinary abs"),Array(6).fill(33));assert.deepEqual(values(result,"Builtin abs"),closeValues);
 assert.deepEqual(values(result,"Type-name Side"),Array(6).fill(55));assert.deepEqual(values(result,"Type-name Other"),Array(6).fill(66));
});

test("optional-only and parameter-name-only differences are invalid declarations even when unused",async()=>{
 for(const declarations of [
  'invalid(float value)=>11\ninvalid(float renamed)=>22',
  'invalid(float value)=>11\ninvalid(float value,float optional=1.0)=>22',
  'invalid(int value=1)=>11\ninvalid(bool condition=false)=>22',
 ]){
  await assert.rejects(run(declarations+'\nplot(1,"Unused")'),/overload|duplicate|ambiguous/i);
 }
});

test("invalid arity unknown duplicate named arguments and foreign types reject rather than selecting a body",async()=>{
 const declarations='select(int value)=>11\nselect(bool value)=>22\n';
 for(const call of ['select()','select(1,2)','select(wrong=1)','select(value=1,value=2)','select(value=1,2)','select("wrong")']){
  await assert.rejects(run(declarations+'plot('+call+',"Invalid")'),/overload|argument|parameter|ambiguous|Unexpected|type/i,call);
 }
 await assert.rejects(run(enums+'enum Third\n    a="Same"\nselect(Side value)=>11\nselect(Other value)=>22\nplot(select(Third.a),"Foreign")'),/overload|enum|type/i);
});

test("actual worker strategy orders and closed-trade ledger retain overload-selected quantities",async()=>{
 const body=enums+'quantity(Side value)=>2\nquantity(Other value)=>5\nchosen=input.enum(Side.a,"Choose")\nif bar_index==0\n    strategy.entry("Side",strategy.long,qty=quantity(chosen))\nif bar_index==1\n    strategy.close("Side")\nif bar_index==3\n    strategy.entry("Other",strategy.long,qty=quantity(Other.a))\nif bar_index==4\n    strategy.close("Other")\nplot(strategy.position_size,"Position")';
 for(const version of [5,6]){
  const result=await execute(body,{version,declaration:'strategy("Overloaded sizing",initial_capital=10000)'});
  assert.deepEqual(workerValues(result,"Position"),[0,2,0,0,5,0]);
  assert.deepEqual(result.strategy.closedTrades.map(trade=>[trade.entry_id,trade.entry_price,trade.exit_price,trade.size,trade.profit]),[["Side",19,29,2,20],["Other",49,59,5,50]]);
  assert.equal(result.strategy.metrics.netprofit,70);assert.equal(result.strategy.metrics.equity,10070);
 }
});

test("generic nested wrappers specialize each enum signature with independent persistent call state",async()=>{
 const declarations=[
  'choose(Side value)=>\n    var int total=0\n    total+=value==Side.a?1:2\n    total',
  'choose(Other value)=>\n    var int total=100\n    total+=10\n    total',
 ];
 const calls=[
  'plot(chain(Side.a),"Side A")','plot(chain(Other.a),"Other A")',
  'plot(chain(Side.b),"Side B")','plot(delegate(Other.a),"Other direct")',
 ];
 for(const version of [5,6])for(const reverse of [false,true]){
  const body=enums+(reverse?[...declarations].reverse():declarations).join('\n')+
   '\ndelegate(value)=>choose(value)\nchain(value)=>delegate(value)\n'+(reverse?[...calls].reverse():calls).join('\n');
  const result=await run(body,version);
  assert.deepEqual(values(result,"Side A"),[1,2,3,4,5,6]);
  assert.deepEqual(values(result,"Side B"),[2,4,6,8,10,12]);
  assert.deepEqual(values(result,"Other A"),[110,120,130,140,150,160]);
  assert.deepEqual(values(result,"Other direct"),[110,120,130,140,150,160]);
 }
});

test("generic nested wrappers preserve enum parameter history without sharing sibling slots",async()=>{
 const body=enums+'prior(Side value)=>bar_index==0?0:value[1]==Side.a?11:12\nprior(Other value)=>bar_index==0?0:value[1]==Other.a?22:23\ndelegate(value)=>prior(value)\nchain(value)=>delegate(value)\nalternating=bar_index%2==0?Side.a:Side.b\nother=bar_index%2==0?Other.a:Other.b\nplot(chain(alternating),"Alternating")\nplot(chain(Side.b),"Constant Side")\nplot(chain(other),"Other")';
 const result=await run(body);
 assert.deepEqual({alternating:values(result,"Alternating"),constant:values(result,"Constant Side"),other:values(result,"Other")},
  {alternating:[0,11,12,11,12,11],constant:[0,12,12,12,12,12],other:[0,22,23,22,23,22]});
});

test("versioned constant division and integer built-ins choose their numeric overload at execution",async()=>{
 // https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/#fractional-division-of-constants
 const declarations='pick(int value)=>1000+value\npick(float value)=>2000+value\nconst int numerator=5\nconst int denominator=2\n';
 const failures=[];
 for(const version of [5,6])for(const [name,expression,expected] of [
  ["Constants","numerator/denominator",version===5?1002:2002.5],
  ["Literals","5/2",version===5?1002:2002.5],
  ["Bars since","ta.barssince(true)",1000],["Integer min","math.min(1,2)",1001],
 ]){
  try{const result=await run(declarations+'plot(pick('+expression+'),"Result")',version);assert.deepEqual(values(result,"Result"),Array(6).fill(expected));}
  catch(error){failures.push("v"+version+" "+name+": "+error.message);}
 }
 assert.deepEqual(failures,[]);
});

test("direct UDT construction copy and typed fields bind the ordinary overload without namespace collisions",async()=>{
 const declarations=enums+'type Box\n    float price\nread(Side value)=>11\nread(Box value)=>value.price+100\npick(int value)=>1000+value\npick(float value)=>2000+value\nBox current=Box.new(close)\n';
 const failures=[];
 for(const [name,expression,expected] of [
  ["Enum","read(Side.a)",Array(6).fill(11)],["Constructor","read(Box.new(close))",closeValues.map(value=>100+value)],
  ["Copy","read(Box.copy(current))",closeValues.map(value=>100+value)],["Field","pick(current.price)",closeValues.map(value=>2000+value)],
 ]){
  try{const result=await run(declarations+'plot('+expression+',"Result")');assert.deepEqual(values(result,"Result"),expected);}
  catch(error){failures.push(name+": "+error.message);}
 }
 assert.deepEqual(failures,[]);
});

test("generic specializations preserve one authored input site and apply the same genuine override",async()=>{
 const body=enums+'choose(Side value)=>11\nchoose(Other value)=>22\ndelegate(value)=>input.int(3,"Length")+choose(value)\nplot(delegate(Side.a),"Side")\nplot(delegate(Other.a),"Other")';
 const prepared=await execute(body,{action:"prepare"}),result=await execute(body,{inputs:{in_0:7}});
 assert.deepEqual({definitions:prepared.inputDefinitions.map(definition=>({id:definition.id,type:definition.type,title:definition.title,defval:definition.defval})),inputs:result.inputs,
  side:workerValues(result,"Side"),other:workerValues(result,"Other")},
  {definitions:[{id:"in_0",type:"int",title:"Length",defval:3}],inputs:{in_0:7},side:Array(6).fill(18),other:Array(6).fill(29)});
 assert.equal(result.source,source(body));
});

test("direct overloaded and handwritten typed wrapper calls preserve enum parameter history",async()=>{
 const body=enums+'prior(Side value)=>bar_index==0?0:value[1]==Side.a?11:12\nprior(Other value)=>bar_index==0?0:value[1]==Other.a?22:23\ntyped(Side value)=>prior(value)\ntyped(Other value)=>prior(value)\nalternating=bar_index%2==0?Side.a:Side.b\nother=bar_index%2==0?Other.a:Other.b\nplot(prior(alternating),"Direct Side")\nplot(prior(other),"Direct Other")\nplot(typed(alternating),"Wrapped Side")\nplot(typed(other),"Wrapped Other")';
 const result=await run(body);
 assert.deepEqual({directSide:values(result,"Direct Side"),directOther:values(result,"Direct Other"),wrappedSide:values(result,"Wrapped Side"),wrappedOther:values(result,"Wrapped Other")},
  {directSide:[0,11,12,11,12,11],directOther:[0,22,23,22,23,22],wrappedSide:[0,11,12,11,12,11],wrappedOther:[0,22,23,22,23,22]});
});
