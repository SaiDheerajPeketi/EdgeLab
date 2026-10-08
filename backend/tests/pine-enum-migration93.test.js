import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
const bundle=(await build({entryPoints:[new URL("../../frontend/src/lib/pineInputMigration.ts",import.meta.url).pathname],bundle:true,minify:true,write:false,platform:"browser",format:"esm",logLevel:"silent"})).outputFiles[0].text;
const {migratePineEnumInputs:migrate}=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const definition=(extra={})=>({id:"in_0",name:"Choice",title:"Choice",type:"enum",defval:"Choice.first",options:["Choice.first","Choice.second"],enumVersion:1,enumType:"Choice",enumMembers:[{id:"Choice.first",label:"First"},{id:"Choice.second",label:"Second"}],...extra});
const prepared=(d=definition(),source="original exact Pine source")=>({kind:"prepare",source,language:"pine",pineVersion:6,declaration:"indicator",name:"Migration93",overlay:false,inputDefinitions:[d],diagnostics:[]});
const legacy=(source="original exact Pine source")=>prepared({id:"in_0",name:"Choice",type:"enum",defval:"First",options:["First","Second"]},source);
test("only unique allowed legacy labels migrate and unrelated values stay untouched",()=>{
 const values={in_0:"Second",in_1:7,in_2:false},result=migrate(legacy(),prepared(),values);
 assert.deepEqual(result,{inputs:{in_0:"Choice.second",in_1:7,in_2:false},recovery:{}});assert.deepEqual(values,{in_0:"Second",in_1:7,in_2:false});
});
test("a legacy label that equals another member ID follows labels rather than guessing an ID",()=>{
 const modern=prepared(definition({enumMembers:[{id:"Choice.first",label:"Choice.second"},{id:"Choice.second",label:"Other"}]}));
 assert.deepEqual(migrate(legacy(),modern,{in_0:"Choice.second"}),{inputs:{in_0:"Choice.first"},recovery:{}});
 assert.deepEqual(migrate(modern,modern,{in_0:"Choice.second"}),{inputs:{in_0:"Choice.second"},recovery:{}},"Already-versioned IDs never undergo label migration");
});
test("ambiguous and unknown legacy values become guaranteed invalid choices with originals preserved",()=>{
 const modern=prepared(definition({enumMembers:[{id:"Choice.first",label:"Same"},{id:"Choice.second",label:"Same"}]}));
 for(const label of ["Same","unknown","Choice.second"]){
  assert.deepEqual(migrate(legacy(),modern,{in_0:label}),{inputs:{in_0:""},recovery:{in_0:label}});
 }
 assert.deepEqual(migrate(legacy(),modern,{in_0:""},{in_0:"Same"}),{inputs:{in_0:""},recovery:{in_0:"Same"}},"A repeated pending migration must not lose the original label");
});
test("subset restrictions can resolve duplicate labels but excluded values never migrate",()=>{
 const modern=prepared(definition({options:["Choice.second"],defval:"Choice.second",enumMembers:[{id:"Choice.first",label:"Same"},{id:"Choice.second",label:"Same"}]}));
 assert.deepEqual(migrate(legacy(),modern,{in_0:"Same"}),{inputs:{in_0:"Choice.second"},recovery:{}});
 const excluded=prepared(definition({options:["Choice.first"],enumMembers:[{id:"Choice.first",label:"First"},{id:"Choice.second",label:"Second"}]}));
 assert.deepEqual(migrate(legacy(),excluded,{in_0:"Second"}),{inputs:{in_0:""},recovery:{in_0:"Second"}});
});
test("missing or mismatched source provenance never guesses and omitted overrides use new defaults",()=>{
 const inputs={in_0:"First"},recovery={in_2:"old"};
 for(const saved of [undefined,legacy("different source"),prepared()]){
  const result=migrate(saved,prepared(),inputs,recovery);assert.equal(result.inputs.in_0,"First");assert.deepEqual(result.recovery,recovery);
 }
 assert.deepEqual(migrate(legacy(),prepared(),{}),{inputs:{},recovery:{}},"The authored default member ID belongs to the new descriptor");
});
test("successful recovery removes only its own receipt and malformed nonlabel scalars remain invalid without coercion",()=>{
 const values={in_0:"First"},recovery={in_0:"Previous label",in_3:"Other original"};
 assert.deepEqual(migrate(legacy(),prepared(),values,recovery),{inputs:{in_0:"Choice.first"},recovery:{in_3:"Other original"}});
 assert.deepEqual(recovery,{in_0:"Previous label",in_3:"Other original"});
 for(const value of [3,true])assert.equal(migrate(legacy(),prepared(),{in_0:value}).inputs.in_0,value);
});

test("malformed saved recovery is bounded plain text without invoking accessors",()=>{
 const recovery={in_0:{unexpected:true},in_1:"valid",in_2:"x".repeat(4097),in_24:"out of range",other:"not an input"};
 Object.defineProperty(recovery,"in_3",{enumerable:true,get(){throw new Error("accessor must stay untouched");}});
 assert.deepEqual(migrate(undefined,prepared(),{in_0:""},recovery),{inputs:{in_0:""},recovery:{in_1:"valid"}});
 assert.deepEqual(migrate(legacy(),prepared(),{in_0:"unknown"},recovery).recovery,{in_0:"unknown",in_1:"valid"});
 for(const bad of [null,3,["invalid"]])assert.deepEqual(migrate(undefined,prepared(),{},bad).recovery,{});
});
