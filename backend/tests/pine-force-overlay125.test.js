import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";
Error.stackTraceLimit=0;
const bundle=(await build({bundle:true,minify:true,platform:"browser",format:"esm",write:false,logLevel:"silent",plugins:[createPineEnginePlugin()],define:{"import.meta.env":"{}"},stdin:{contents:'export * from "./frontend/src/workers/pineNative.worker.ts";export * from "./frontend/src/lib/pineChartAdapter.ts";export * from "./frontend/src/lib/pineProtocol.ts";',resolveDir:new URL("../../",import.meta.url).pathname,loader:"ts",sourcefile:"pine-force-overlay125-oracles.ts"}})).outputFiles[0].text;
console.info("PINE_FORCE_OVERLAY125_BINDING "+JSON.stringify({minify:true,sealed:true,bundleSha256:createHash("sha256").update(bundle).digest("hex"),manifestSha256:createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json",import.meta.url))).digest("hex")}));
const pine=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const candle=(i,close=100)=>({time:1700000040+i*60,open:close,high:close+2,low:close-2,close,volume:20}),bars=Array.from({length:12},(_,i)=>candle(i)),context={symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1};
const shape={line:flag=>'line.new(2,100,8,100,color=#ff0000,force_overlay='+flag+')',box:flag=>'box.new(2,110,8,90,bgcolor=#ff0000,force_overlay='+flag+')',label:flag=>'label.new(5,100,"Demand",color=#ff0000,force_overlay='+flag+')'},key={line:"lines",box:"boxes",label:"labels"};
const request=(body,version=6,overlay=true,behind=true,extra="",snapshot=bars)=>({id:"force125",action:"run",source:'//@version='+version+'\nindicator("Force overlay 125",overlay='+overlay+',behind_chart='+behind+extra+')\n'+body,bars:snapshot,inputs:{},context});
const run=(...args)=>pine.executePineRequest(request(...args));
const body=(kind,flag)=>'var '+kind+' a='+shape[kind](flag);

test('v5/v6 preserve native per-object false defaults and forced flags independently of script pane and behind_chart',async()=>{
 for(const version of[5,6])for(const overlay of[false,true])for(const behind of[false,true])for(const kind of Object.keys(shape)){
  const result=await run(body(kind,false)+'\nvar '+kind+' b='+shape[kind](true),version,overlay,behind);assert.equal(result.overlay,overlay);assert.equal(result.behindChart,behind);assert.deepEqual(result[key[kind]].map(d=>[d.forceOverlay,d.overlay]),[[false,overlay],[true,true]]);assert.equal(Object.keys(result[key[kind]][0]).length,{line:12,box:21,label:16}[kind]);
  const defaulted=await run(body(kind,false).replace(',force_overlay=false',''),version,overlay,behind);assert.equal(defaulted[key[kind]][0].forceOverlay,false);assert.equal(defaulted[key[kind]][0].overlay,overlay);
 }
});
test('chart.point constructors and positional line overload retain force flags through native transport',async()=>{
 for(const version of[5,6]){
  const result=await run('var line a=line.new(chart.point.from_index(2,90),chart.point.from_index(8,110),force_overlay=true)\nvar box b=box.new(chart.point.from_index(2,110),chart.point.from_index(8,90),force_overlay=true)\nvar label c=label.new(chart.point.from_index(5,100),"Demand",force_overlay=true)',version,false);for(const field of Object.values(key))assert.deepEqual(result[field].map(d=>[d.forceOverlay,d.overlay]),[[true,true]]);
  const positional=await run('var line a=line.new(2,90,8,110,xloc.bar_index,extend.none,#ff0000,line.style_solid,2,true)',version,false);assert.equal(positional.lines[0].forceOverlay,true);assert.equal(positional.lines[0].overlay,true);
 }
});
test('native static and method copies preserve front ownership on independent mutated descendants',async()=>{
 for(const version of[5,6])for(const kind of Object.keys(shape))for(const method of[false,true]){
  const setter={line:'b.set_y2(120)',box:'b.set_top(120)',label:'b.set_y(120)'}[kind],result=await run(body(kind,true)+'\nvar '+kind+' b='+(method?'a.copy()':kind+'.copy(a)')+'\n'+setter+'\na.delete()',version,false);assert.equal(result[key[kind]].length,1);assert.equal(result[key[kind]][0].forceOverlay,true);assert.equal(result[key[kind]][0].overlay,true);assert.equal(result[key[kind]][0][{line:'y2',box:'top',label:'y'}[kind]],120);
 }
});
test('strict12/21/16-field drawing protocols reject missing accessors and inconsistent per-object placement without reading hostile values',async()=>{
 for(const kind of Object.keys(shape)){
  const req=request(body(kind,false),6,false),native=await pine.executePineRequest(req),response=result=>({id:req.id,status:'completed',result}),round=pine.validatePineResponse(response(structuredClone(native)),req),saved=structuredClone(round[key[kind]]);native[key[kind]][0].forceOverlay=true;assert.deepEqual(round[key[kind]],saved);
  for(const change of[d=>delete d.forceOverlay,d=>d.forceOverlay=1,d=>d.forceOverlay='true',d=>d.forceOverlay=null,d=>d.forceOverlay=true,d=>d.overlay=true,d=>d.extra=1]){const forged=structuredClone(round);change(forged[key[kind]][0]);assert.throws(()=>pine.validatePineResponse(response(forged),req));}
  let reads=0;const forged=structuredClone(round);Object.defineProperty(forged[key[kind]][0],'forceOverlay',{enumerable:true,get(){reads++;return false;}});assert.throws(()=>pine.validatePineResponse(response(forged),req));assert.equal(reads,0);
  const forcedReq=request(body(kind,true),6,false),forced=await pine.executePineRequest(forcedReq);forced[key[kind]][0].overlay=false;assert.throws(()=>pine.validatePineResponse({id:forcedReq.id,status:'completed',result:forced},forcedReq));
 }
});
test('adapter keeps one drawing group per placement with every forced or regular object and shared fill reference',async()=>{
 for(const overlay of[false,true]){
  const src=Object.keys(shape).map(kind=>body(kind,false).replace(' a=',' regular_'+kind+'=')+'\nvar '+kind+' f_'+kind+'='+shape[kind](true)).join('\n')+'\nvar line upper=line.new(2,110,8,110,color=na,force_overlay=true)\nvar line lower=line.new(2,90,8,90,color=na,force_overlay=true)\nlinefill.new(upper,lower,#00ff00)',result=await run(src,6,overlay),adapted=pine.adaptPineChartResult(result,bars),drawings=adapted.plots.filter(p=>p.kind==='drawing_line');assert.equal(drawings.length,overlay?1:2);for(const plot of drawings){for(const field of Object.values(key)){assert.deepEqual(plot.drawing[field].map(d=>d.id),result[field].filter(d=>d.overlay===plot.overlay).map(d=>d.id));}const ids=new Set(plot.drawing.lines.map(l=>l.id));for(const fill of plot.drawing.lineFills??[]){assert.ok(ids.has(fill.line1));assert.ok(ids.has(fill.line2));}}assert.equal(drawings.reduce((n,p)=>n+(p.drawing.labels?.length??0),0),2);assert.equal(drawings.reduce((n,p)=>n+(p.drawing.lineFills?.length??0),0),1);
 }
});
test('native fill metadata stays unchanged and mixed boundary force flags are honestly warned while references remain intact',async()=>{
 for(const[one,two]of[[false,false],[true,false],[false,true],[true,true]]){const result=await run('var line a=line.new(2,110,8,110,color=na,force_overlay='+one+')\nvar line b=line.new(2,90,8,90,color=na,force_overlay='+two+')\nlinefill.new(a,b,#ff0000)'),adapted=pine.adaptPineChartResult(result,bars),plot=adapted.plots.find(p=>p.kind==='drawing_line');assert.equal(result.lines.find(l=>l.y1===110).forceOverlay,one);assert.equal(result.lines.find(l=>l.y1===90).forceOverlay,two);assert.equal(Object.keys(result.lineFills[0]).length,5);assert.deepEqual(plot.drawing.lineFills,result.lineFills);assert.equal(result.lineFills[0].line1,result.lines.find(l=>l.y1===110).id);assert.equal(result.lineFills[0].line2,result.lines.find(l=>l.y1===90).id);if(one!==two)assert.ok(adapted.warnings.some(w=>/mixed|boundary|layer/i.test(w)));}
});
test('persistent native sessions restore regular roots after provisional forced GC and retain forced committed descendants',async()=>{
 for(const version of[5,6])for(const kind of Object.keys(shape)){
  const src=body(kind,false)+'\nif barstate.isrealtime and close>105\n    '+shape[kind](true),sessionId='force-overlay125-live-'+version+'-'+kind,req={...request(src,version,true,true,',max_'+key[kind]+'_count=1',bars.slice(0,3)),mode:'live',id:sessionId+':0'},executor=pine.createPineLiveExecutor(),initial=await executor.execute({protocol:'pine-live-v1',sessionId,sequence:0,action:'start',request:req}),held=structuredClone(initial),command=(sequence,close,confirmed=false)=>({protocol:'pine-live-v1',sessionId,sequence,action:'update',bar:candle(sequence===4?4:3,close),confirmed});assert.equal(initial[key[kind]][0].forceOverlay,false);
  const changed=await executor.execute(command(1,110)),saved=structuredClone(changed);assert.equal(changed[key[kind]][0].forceOverlay,true);const restored=await executor.execute(command(2,95));assert.deepEqual(restored[key[kind]],initial[key[kind]]);assert.deepEqual(initial,held);assert.deepEqual(changed,saved);const committed=await executor.execute(command(3,110,true)),next=await executor.execute(command(4,95));assert.equal(committed[key[kind]][0].forceOverlay,true);assert.deepEqual(next[key[kind]],committed[key[kind]]);executor.dispose();
 }
});
test('NA coordinates and invisible color payloads retain force identity without dropping their owned object',async()=>{
 for(const kind of Object.keys(shape)){const src={line:'line.new(na,na,na,na,color=na,force_overlay=true)',box:'box.new(na,na,na,na,border_color=na,bgcolor=na,text_color=na,force_overlay=true)',label:'label.new(na,na,na,color=na,textcolor=na,force_overlay=true)'}[kind],result=await run('var '+kind+' a='+src,6,false);assert.equal(result[key[kind]].length,1);assert.equal(result[key[kind]][0].forceOverlay,true);assert.equal(result[key[kind]][0].overlay,true);}
});
