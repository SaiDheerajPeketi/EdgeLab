import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {build} from "esbuild";
import {createPineEnginePlugin} from "../../scripts/pine-engine.mjs";
const root=new URL("../../",import.meta.url).pathname;
const bundled=(await build({bundle:true,minify:true,format:"esm",platform:"browser",write:false,logLevel:"silent",plugins:[createPineEnginePlugin()],stdin:{
 contents:'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pineInputActivation.ts";',
 loader:"ts",resolveDir:root,sourcefile:"pine-input-active89-oracles.ts"
}})).outputFiles[0].text;
const pine=await import("data:text/javascript;base64,"+Buffer.from(bundled).toString("base64"));
const bars=JSON.parse(fs.readFileSync(new URL("../../e2e/pine-visuals.bars.json",import.meta.url))).slice(0,4);
const source=(body,version=6)=>"//@version="+version+'\nindicator("Activation89")\n'+body;
const request=(code,action="prepare",inputs={})=>({id:"active89",action,source:code,inputs,...(action==="run"?{bars,context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1}}:{})});
const execute=(code,action="prepare",inputs={})=>pine.executePineRequest(request(code,action,inputs));
const byTitle=(result,title)=>{const definition=result.inputDefinitions.find(d=>d.title===title);assert.ok(definition,title);return definition};
const values=(result,entries)=>Object.fromEntries(Object.entries(entries).map(([title,value])=>[byTitle(result,title).id,value]));
const simple='enabled=input.bool(false,"Enable")\nlength=input.int(4,"Length",minval=1,maxval=9,active=enabled)\nplot(length,"Output")';
test("minified reviewed worker prepares and runs stable input IDs with current boolean activation in v5 and v6",async()=>{
 for(const version of [5,6]){
  const code=source(simple,version),prepared=await execute(code),enable=byTitle(prepared,"Enable"),length=byTitle(prepared,"Length");
  assert.equal(length.active,false);assert.ok(length.activeCondition);
  assert.equal(pine.pineInputActive(length,prepared.inputDefinitions,{[enable.id]:true}),true,"Current editor values must take precedence over sampled metadata");
  assert.equal(pine.pineInputActive(length,prepared.inputDefinitions,{}),false,"Missing current values use declared defaults");
  for(const enabled of [true,false,true]){
   const inputs={[enable.id]:enabled,[length.id]:7},result=await execute(code,"run",inputs);
   assert.deepEqual(result.inputDefinitions.map(d=>d.id),prepared.inputDefinitions.map(d=>d.id));
   assert.equal(byTitle(result,"Length").active,enabled);
   assert.deepEqual(result.inputs,inputs);assert.deepEqual(result.plots[0].points.map(p=>p.value),Array(4).fill(7),"Inactive inputs retain their supplied numeric values");
   assert.deepEqual(byTitle(result,"Length").activeCondition,length.activeCondition);
  }
 }
});
test("comparisons arithmetic aliases logical operators and ternaries follow independently computed current-value truth tables",async()=>{
 const body='enabled=input.bool(false,"Enable")\nmode=input.string("Basic","Mode",options=["Basic","Advanced"])\ncount=input.int(2,"Count",minval=0,maxval=10)\nexpert=mode=="Advanced"\npositive=expert and count*2>=6\nnegative=not enabled and -count<0\nbranch=enabled ? count%2==0 : expert\none=input.float(1.25,"Positive",active=positive)\ntwo=input.float(2.5,"Negative",active=negative)\nthree=input.int(3,"Branch",active=branch)\nplot(one+two+three,"Total")';
 for(const version of [5,6]){
  const code=source(body,version),prepared=await execute(code);
  for(const [enabled,mode,count] of [[false,"Basic",2],[false,"Advanced",3],[true,"Advanced",4],[true,"Basic",1],[false,"Advanced",0]]){
   const inputs=values(prepared,{Enable:enabled,Mode:mode,Count:count});
   const expected=[mode==="Advanced"&&count*2>=6,!enabled&&-count<0,enabled?count%2===0:mode==="Advanced"];
   const current=["Positive","Negative","Branch"].map(title=>pine.pineInputActive(byTitle(prepared,title),prepared.inputDefinitions,inputs));
   assert.deepEqual(current,expected);
   const result=await execute(code,"run",inputs);
   assert.deepEqual(["Positive","Negative","Branch"].map(title=>byTitle(result,title).active),expected);
   assert.deepEqual(result.plots[0].points.map(p=>p.value),Array(4).fill(6.75));
  }
 }
});
test("omitted literal and dependent booleans have distinct activation without resetting disabled values",async()=>{
 const prepared=await execute(source('enabled=input.bool(true,"Enable")\nomitted=input.int(2,"Omitted")\nlocked=input.int(3,"Locked",active=false)\nflag=input.bool(true,"Flag",active=enabled)\nplot(locked,"Locked output")'));
 const enabled=byTitle(prepared,"Enable"),flag=byTitle(prepared,"Flag");
 assert.equal(pine.pineInputActive(byTitle(prepared,"Omitted"),prepared.inputDefinitions,{}),true);
 assert.equal(pine.pineInputActive(byTitle(prepared,"Locked"),prepared.inputDefinitions,{}),false);
 assert.equal(pine.pineInputActive(flag,prepared.inputDefinitions,{[enabled.id]:false,[flag.id]:true}),false);
 const custom=values(prepared,{Enable:false,Locked:8,Flag:false}),result=await execute(prepared.source,"run",custom);
 assert.equal(byTitle(result,"Flag").active,false);assert.equal(result.inputs[flag.id],false);assert.deepEqual(result.plots[0].points.map(p=>p.value),Array(4).fill(8));
});
test("input-dependent division remains fractional for v5 and v6 and disabled values still undergo validation",async()=>{
 for(const version of [5,6]){
  const code=source('count=input.int(5,"Count",minval=0,maxval=10)\ndivisor=input.int(2,"Divisor",minval=0,maxval=10)\nlength=input.int(4,"Length",minval=1,maxval=9,active=count/divisor>2)\nplot(length)',version);
  const prepared=await execute(code);
  assert.equal(byTitle(prepared,"Length").active,true);
  const inactive=await execute(code,"prepare",values(prepared,{Count:4}));assert.equal(byTitle(inactive,"Length").active,false);
  const zeroInputs=values(prepared,{Count:5,Divisor:0});assert.equal(pine.pineInputActive(byTitle(prepared,"Length"),prepared.inputDefinitions,zeroInputs),false);
  const zero=await execute(code,"run",zeroInputs);assert.equal(byTitle(zero,"Length").active,false);assert.deepEqual(zero.plots[0].points.map(p=>p.value),Array(4).fill(4));
  await assert.rejects(execute(code,"run",values(prepared,{Count:0,Length:20})),/range|input/i);
  await assert.rejects(execute(code,"run",values(prepared,{Count:0,Length:"bad"})),/input|value/i);
 }
});
test("series calls and unresolved aliases fail explicitly instead of silently producing permanently disabled inputs",async()=>{
 for(const condition of ["close>open","math.abs(count)>0","unknownFlag","bar_index==0"]){
  await assert.rejects(execute(source('count=input.int(2,"Count")\nlength=input.int(4,"Length",active='+condition+')\nplot(length)')),/activation|active|compile|unsupported/i,condition);
 }
});
const literal=value=>({kind:"literal",value}),input=id=>({kind:"input",id});
test("activation validator rejects malformed excessive cyclic or executable data without invoking getters or coercion",()=>{
 const valid={kind:"conditional",test:{kind:"binary",operator:">",left:input("in_0"),right:literal(2)},consequent:literal(true),alternate:literal(false)};
 assert.deepEqual(pine.validatePineInputCondition(valid),valid);
 let calls=0;const getter={};Object.defineProperty(getter,"kind",{enumerable:true,get(){calls++;return"literal"}});
 const coercion={kind:"unary",operator:{toString(){calls++;return"!"}},argument:literal(true)};
 const cyclic={kind:"unary",operator:"!"};cyclic.argument=cyclic;
 let deep=literal(true);for(let i=0;i<8;i++)deep={kind:"unary",operator:"!",argument:deep};
 const wide=depth=>depth?{kind:"binary",operator:"&&",left:wide(depth-1),right:wide(depth-1)}:literal(true);
 const bad=[getter,coercion,cyclic,deep,wide(6),[],null,{kind:"constructor"},literal(null),literal(Infinity),
  {kind:"input",id:"__proto__"}, {kind:"input",id:"in_0",extra:true},{kind:"unary",operator:"typeof",argument:literal(1)},
  {kind:"binary",operator:"eval",left:literal(1),right:literal(2)},{kind:"literal",value:true,[Symbol("secret")]:1},
  Object.assign(Object.create({inherited:true}),literal(true))];
 for(const condition of bad)assert.throws(()=>pine.validatePineInputCondition(condition),/activation|expression|fields|operator/i);
 assert.equal(calls,0,"Validation must never execute getters or coerce operator objects");
});
test("wire protocol preserves safe activation but rejects missing self and forward references",async()=>{
 const prepared=await execute(source(simple)),req=request(prepared.source),length=byTitle(prepared,"Length");
 assert.deepEqual(pine.validatePineResponse({id:req.id,status:"completed",result:prepared},req),prepared);
 for(const condition of [input("in_999"),input(length.id),literal("not a boolean"),{kind:"conditional",test:input(prepared.inputDefinitions[0].id),consequent:literal(true),alternate:literal("bad branch")},{kind:"unary",operator:"!",argument:literal("bad unary type")},{kind:"binary",operator:"&&",left:literal(1),right:literal(true)},{kind:"literal",value:true,extra:"unreviewed"}]){
  const changed=structuredClone(prepared);byTitle(changed,"Length").activeCondition=condition;
  assert.throws(()=>pine.validatePineResponse({id:req.id,status:"completed",result:changed},req),/activation|metadata|reference/i);
 }
 const forward=structuredClone(prepared);forward.inputDefinitions[0].activeCondition=input(length.id);
 assert.throws(()=>pine.validatePineResponse({id:req.id,status:"completed",result:forward},req),/activation|reference/i);
});
