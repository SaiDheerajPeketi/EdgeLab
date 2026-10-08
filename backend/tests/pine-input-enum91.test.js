import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {build} from "esbuild";
import {createPineEnginePlugin} from "../../scripts/pine-engine.mjs";
const root=new URL("../../",import.meta.url).pathname;
const bundled=(await build({bundle:true,minify:true,format:"esm",platform:"browser",write:false,logLevel:"silent",plugins:[createPineEnginePlugin()],stdin:{
 contents:'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts";',
 loader:"ts",resolveDir:root,sourcefile:"pine-input-enum91-oracles.ts"
}})).outputFiles[0].text;
const pine=await import("data:text/javascript;base64,"+Buffer.from(bundled).toString("base64"));
const bars=JSON.parse(fs.readFileSync(new URL("../../e2e/pine-visuals.bars.json",import.meta.url))).slice(0,4);
const source=(body,version=6)=>"//@version="+version+'\nindicator("Enums91")\n'+body;
const request=(code,action="prepare",inputs={})=>({id:"enum91",action,source:code,inputs,...(action==="run"?{bars,context:{symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1}}:{})});
const execute=async(code,action="prepare",inputs={})=>{try{return await pine.executePineRequest(request(code,action,inputs))}catch(error){error.stack=error.name+": "+error.message;throw error}};
const declaration='enum Side\n    up = "Up"\n    down = "Down"\n    flat = "Flat"\n';
const aliasBody=declaration+'const Side alias = Side.up\nchoice=input.enum(alias,"Direction")\nplot(choice==Side.up?1:choice==Side.down?-1:0,"Signal")';
const definition=result=>{assert.equal(result.inputDefinitions.length,1);return result.inputDefinitions[0]};
test("v5 and v6 constant enum aliases retain complete selectable fields source and stable native IDs",async()=>{
 for(const version of [5,6]){
  const code=source(aliasBody,version),prepared=await execute(code),direct=await execute(source(aliasBody.replace("input.enum(alias","input.enum(Side.up"),version));
  assert.equal(prepared.source,code);assert.equal(definition(prepared).type,"enum");assert.equal(definition(prepared).defval,"Side.up");
  assert.deepEqual(definition(prepared).options,["Side.up","Side.down","Side.flat"]);assert.equal(definition(prepared).id,definition(direct).id);
  for(const [chosen,signal] of [["Side.up",1],["Side.down",-1],["Side.flat",0]]){
   const inputs={[definition(prepared).id]:chosen},result=await execute(code,"run",inputs);
   assert.equal(result.source,code);assert.deepEqual(result.inputDefinitions,prepared.inputDefinitions);assert.deepEqual(result.inputs,inputs);
   assert.deepEqual(result.plots[0].points.map(p=>p.value),Array(4).fill(signal));
   assert.deepEqual(pine.validatePineResponse({id:"enum91",status:"completed",result},request(code,"run",inputs)),result);
  }
 }
});
test("inferred typed chained and constant ternary aliases keep their enum origin",async()=>{
 for(const version of [5,6])for(const aliases of [
  'alias=Side.down',
  'const Side first=Side.down\nconst Side alias=first',
  'const Side first=Side.up\nconst Side second=Side.down\nconst bool pickFirst=false\nconst Side alias=pickFirst?first:second',
  'const bool choose=true\nconst Side alias=choose?(false?Side.flat:Side.down):Side.up'
 ]){
  const code=source(declaration+aliases+'\nchoice=input.enum(alias,"Direction")\nplot(choice==Side.down?-1:1)',version),prepared=await execute(code);
  assert.deepEqual(definition(prepared).options,["Side.up","Side.down","Side.flat"]);assert.equal(definition(prepared).defval,"Side.down");
  assert.deepEqual((await execute(code,"run")).plots[0].points.map(p=>p.value),Array(4).fill(-1));
 }
});
test("aliased explicit option subsets preserve order and exclude undeclared overrides",async()=>{
 for(const version of [5,6]){
  const code=source(declaration+'const Side falling=Side.down\nconst Side neutral=Side.flat\nconst Side defaultChoice=true?neutral:falling\nchoice=input.enum(defaultChoice,"Direction",options=[neutral,falling])\nplot(choice==Side.down?-1:0)',version),prepared=await execute(code),input=definition(prepared);
  assert.deepEqual(input.options,["Side.flat","Side.down"]);assert.equal(input.defval,"Side.flat");
  const custom=await execute(code,"run",{[input.id]:"Side.down"});assert.deepEqual(custom.plots[0].points.map(p=>p.value),Array(4).fill(-1));
  for(const action of ["prepare","run"])for(const value of ["Side.up","Down","not an enum",4,true,null]){
   await assert.rejects(execute(code,action,{[input.id]:value}),/input|option|value/i,String(value));
  }
 }
});
test("alias defaults outside options and alias fields from different enums are rejected before execution",async()=>{
 const other='enum Other\n    up = "Up"\n    down = "Down"\n';
 for(const version of [5,6]){
  for(const tail of [
   'const Side chosen=Side.up\nconst Side allowed=Side.down\nchoice=input.enum(chosen,"Direction",options=[allowed])',
   'const Side chosen=Side.up\nconst Other allowed=Other.up\nchoice=input.enum(chosen,"Direction",options=[allowed])',
   'const Side chosen=Side.up\nconst Side allowed=Side.down\nconst Other alien=Other.down\nchoice=input.enum(chosen,"Direction",options=[chosen,allowed,alien])'
  ])await assert.rejects(execute(source(declaration+other+tail+'\nplot(1)',version)),/same enum|defval.*options|enum/i);
 }
});
test("direct default and aliased options use field identity even when enum titles match",async()=>{
 const code=source(declaration+'enum Other\n    up = "Up"\nconst Other alien=Other.up\nchoice=input.enum(Side.up,"Direction",options=[alien])\nplot(1)');
 await assert.rejects(execute(code),/same enum/i,"Equal rendered strings must not erase enum origin");
 const invalid=source(declaration+'const Side allowed=Side.down\nchoice=input.enum(Side.up,"Direction",options=[allowed])\nplot(1)');
 await assert.rejects(execute(invalid),/defval.*options/i);
});
test("prepared enum metadata round trips through protocol and old missing-options snapshots stay refreshable",async()=>{
 const code=source(aliasBody),prepared=await execute(code),req=request(code);
 const validated=pine.validatePineResponse({id:req.id,status:"completed",result:JSON.parse(JSON.stringify(prepared))},req);
 assert.deepEqual(definition(validated).options,["Side.up","Side.down","Side.flat"]);
 const legacy=structuredClone(prepared);for(const key of ["options","enumVersion","enumType","enumMembers"])delete definition(legacy)[key];definition(legacy).defval="Up";
 assert.equal(definition(pine.validatePineResponse({id:req.id,status:"completed",result:legacy},req)).options,undefined);
 for(const options of [[{}],["Up",()=>{}]]){const bad=structuredClone(prepared);definition(bad).options=options;assert.throws(()=>pine.validatePineResponse({id:req.id,status:"completed",result:bad},req),error=>error instanceof pine.PineProtocolError);}
});
