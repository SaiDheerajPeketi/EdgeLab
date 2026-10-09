import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createPineEnginePlugin } from '../../scripts/pine-engine.mjs';
Error.stackTraceLimit=0;
const bundle=(await build({bundle:true,minify:true,platform:'browser',format:'esm',write:false,logLevel:'silent',plugins:[createPineEnginePlugin()],define:{'import.meta.env':'{}'},stdin:{contents:'export * from "./frontend/src/workers/pineNative.worker.ts";export * from "./frontend/src/lib/pineProtocol.ts";export { adaptPineChartResult } from "./frontend/src/lib/pineChartAdapter.ts";export { toPineWireResponse } from "./frontend/src/lib/pinePacked.ts";',resolveDir:new URL('../../',import.meta.url).pathname,loader:'ts'}})).outputFiles[0].text;
console.info('PINE_TABLES132_BINDING '+JSON.stringify({minify:true,bundleSha256:createHash('sha256').update(bundle).digest('hex'),manifestSha256:createHash('sha256').update(fs.readFileSync(new URL('../../frontend/vendor/pinets/manifest.json',import.meta.url))).digest('hex')}));
const pine=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
const candle=(i,close=100)=>({time:1700000040+i*60,open:close,high:close+2,low:close-2,close,volume:10});
const bars=Array.from({length:12},(_,i)=>candle(i)), context={symbol:'TEST',timeframe:'1',mintick:.01,pointvalue:1};
const request=(body,version=6,overlay=false,snapshot=bars)=>({id:'tables132',action:'run',source:'//@version='+version+'\nindicator("Tables 132",overlay='+overlay+')\n'+body,bars:snapshot,inputs:{},context});
const run=(...args)=>pine.executePineRequest(request(...args));
const body='var table t=table.new(position.top_right,2,2,#010203,#040506,2,#070809,3,force_overlay=true)\nif barstate.islast\n    table.cell(t,0,0,"one\\ntwo",width=125,height=12,text_color=#ffffff,text_halign=text.align_left,text_valign=text.align_bottom,text_size=size.large,bgcolor=na,tooltip="safe <b>text</b>",text_font_family=font.family_monospace,text_formatting=text.format_bold+text.format_italic)\n    table.merge_cells(t,0,0,1,0)';
const response=(result,req)=>({id:req.id,status:'completed',result});

test('v5/v6 genuine worker exports final native thirteen-field tables and twelve-field cells without table omission notices',async()=>{
 for(const version of[5,6]){
  const r=await run(body,version),t=r.tables[0],cell=t.cells[0][0];
  assert.equal(Object.keys(t).length,13);assert.equal(Object.keys(cell).length,12);assert.equal(t.columns,2);assert.equal(t.rows,2);assert.equal(t.position,'top_right');assert.equal(t.overlay,true);assert.equal(t.forceOverlay,true);assert.equal(t.bgcolor,'#010203');assert.equal(t.frameColor,'#040506');assert.equal(t.borderColor,'#070809');assert.equal(t.frameWidth,2);assert.equal(t.borderWidth,3);
  assert.deepEqual(cell,{populated:true,text:'one\ntwo',width:125,height:12,textColor:'#ffffff',textHalign:'left',textValign:'bottom',textSize:20,bgcolor:null,tooltip:'safe <b>text</b>',textFontFamily:'monospace',textFormatting:'bolditalic'});
  assert.equal(t.cells[0][1].populated,false);assert.equal(t.cells[1][0],null);assert.deepEqual(t.merges,[{startCol:0,startRow:0,endCol:1,endRow:0}]);assert.deepEqual(r.plots,[]);assert.ok(!r.diagnostics.some(d=>/table/i.test(d.message)&&/unsupported|not exposed/i.test(d.message)));
 }
});
test('table text sizes normalize native string constants and numeric points, with independent NA colors and invisible empty allocation',async()=>{
 for(const[setting,size]of[['size.auto',0],['size.tiny',8],['size.small',10],['size.normal',14],['size.large',20],['size.huge',36],['17',17]]){
  const r=await run('var table t=table.new(position.top_left,1,1)\nif barstate.islast\n    table.cell(t,0,0,"",text_size='+setting+',text_color=na,bgcolor=color(na))'),t=r.tables[0];assert.equal(t.cells[0][0].textSize,size);assert.equal(t.cells[0][0].textColor,null);assert.equal(t.cells[0][0].bgcolor,null);assert.equal(t.cells[0][0].populated,true);assert.equal(t.bgcolor,null);
 }
 const r=await run('var table t=table.new(position.top_right,1,1)');assert.deepEqual(r.tables[0].cells,[[null]]);assert.deepEqual(r.tables[0].merges,[]);
});
test('strict table protocol owns nested snapshots and rejects extra fields, coordinates, settings, identities and placement changes',async()=>{
 const req=request(body),native=await pine.executePineRequest(req),valid=pine.validatePineResponse(response(native,req),req),held=structuredClone(valid.tables);native.tables[0].cells[0][0].text='mutated';native.tables[0].merges[0].endCol=0;assert.deepEqual(valid.tables,held);
 const invalid=[t=>t.extra=1,t=>delete t.cells,t=>t.id='',t=>t.position='bottom_panel',t=>t.columns=0,t=>t.columns=1.5,t=>t.columns=Infinity,t=>t.rows=4097,t=>t.cells.pop(),t=>t.cells[0].pop(),t=>t.cells[0][0].extra=1,t=>delete t.cells[0][0].populated,t=>t.cells[0][0].populated=1,t=>t.cells[0][0].text='x'.repeat(4097),t=>t.cells[0][0].tooltip='x'.repeat(4097),t=>t.cells[0][0].width=-1,t=>t.cells[0][0].width=1000001,t=>t.cells[0][0].height=NaN,t=>t.cells[0][0].textSize=513,t=>t.cells[0][0].textSize=1.5,t=>t.cells[0][0].textHalign='wrong',t=>t.cells[0][0].textValign='wrong',t=>t.cells[0][0].textFontFamily='url(x)',t=>t.cells[0][0].textFormatting='underline',t=>t.cells[0][0].textColor='url(javascript:x)',t=>t.frameColor='url(x)',t=>t.borderWidth=17,t=>t.frameWidth=1.5,t=>t.overlay=false,t=>t.forceOverlay=false,t=>t.merges[0].extra=1,t=>t.merges[0].endCol=2,t=>t.merges[0].startCol=2,t=>t.merges.push({...t.merges[0]})];
 for(const change of invalid){const r=structuredClone(valid);change(r.tables[0]);assert.throws(()=>pine.validatePineResponse(response(r,req),req));}
 const duplicate=structuredClone(valid);duplicate.tables.push({...duplicate.tables[0]});assert.throws(()=>pine.validatePineResponse(response(duplicate,req),req));const samePosition=structuredClone(valid);samePosition.tables.push({...samePosition.tables[0],id:'other'});assert.throws(()=>pine.validatePineResponse(response(samePosition,req),req));
});
test('ordinary table arrays and fields reject accessors without invoking getters, sparse cells and inherited metadata',async()=>{
 const req=request(body),native=await pine.executePineRequest(req);
 for(const target of['table','cell','merge','rowslot','cellslot']){
  const r=structuredClone(native),t=r.tables[0];let reads=0;
  const[object,key]=target==='table'?[t,'position']:target==='cell'?[t.cells[0][0],'text']:target==='merge'?[t.merges[0],'startCol']:target==='rowslot'?[t.cells,'0']:[t.cells[0],'0'];
  Object.defineProperty(object,key,{enumerable:true,get(){reads++;return 'bad';}});assert.throws(()=>pine.validatePineResponse(response(r,req),req));assert.equal(reads,0,target);
 }
 const sparse=structuredClone(native);delete sparse.tables[0].cells[1][1];assert.throws(()=>pine.validatePineResponse(response(sparse,req),req));
 const inherited=structuredClone(native);Object.setPrototypeOf(inherited.tables[0].cells[0][0],{extra:1});assert.throws(()=>pine.validatePineResponse(response(inherited,req),req));
 const hidden=structuredClone(native);Object.defineProperty(hidden.tables[0].cells[0],Symbol('hidden'),{value:1});assert.throws(()=>pine.validatePineResponse(response(hidden,req),req));
});
test('native and transport budgets accept 4096 allocated nullable cells, reject cumulative overage, and retain nine independent positions',async()=>{
 const r=await run('var table t=table.new(position.top_right,64,64)'),t=r.tables[0];assert.equal(t.cells.length,64);assert.equal(t.cells[0].length,64);
 const forged=structuredClone(r);forged.tables.push({...structuredClone(t),id:'other',position:'top_left',columns:1,rows:1,cells:[[null]]});assert.throws(()=>pine.validatePineResponse(response(forged,request('var table t=table.new(position.top_right,64,64)')),request('var table t=table.new(position.top_right,64,64)')),/4096/);
 await assert.rejects(run('var table t=table.new(position.top_right,64,64)\nvar table other=table.new(position.top_left,1,1)'),/4096/);
 const positions=pine.PINE_TABLE_POSITIONS,source=positions.map((position,i)=>'var table t'+i+'=table.new(position.'+position+',1,1)').join('\n'),all=await run(source);assert.equal(all.tables.length,9);assert.deepEqual(all.tables.map(t=>t.position),positions);
 const over=structuredClone(all);over.tables.push({...structuredClone(all.tables[0]),id:'tenth'});const req=request(source);assert.throws(()=>pine.validatePineResponse(response(over,req),req));
});
test('packed numeric histories preserve final table metadata and all table cells outside native plot channels',async()=>{
 const snapshot=Array.from({length:5000},(_,i)=>candle(i)),req=request(body+'\nplot(close,"Packed")',6,false,snapshot),r=await pine.executePineRequest(req);assert.equal(r.tables.length,1);assert.equal(r.plots[0].points.length,5000);
 const wire=pine.toPineWireResponse(req.id,r,snapshot);assert.equal(wire.encoding,'pine-packed-v1');const decoded=pine.validatePineResponse(wire,req);assert.deepEqual(decoded.tables,r.tables);assert.equal(decoded.plots[0].points.length,5000);
});
test('unsupported cell styles are explicitly omitted without a fallback table or generic unsupported-table warning',async()=>{
 const r=await run('var table t=table.new(position.top_right,1,1)\nif barstate.islast\n    table.cell(t,0,0,"text",text_font_family="unknown")');assert.deepEqual(r.tables,[]);assert.ok(r.diagnostics.some(d=>d.code==='UNSUPPORTED_TABLE_SETTING'));assert.ok(!r.diagnostics.some(d=>d.code==='UNSUPPORTED_DRAWING'&&/table/.test(d.message)));
});
test('actual persistent worker transports rolled-back conditional mutation/deletion/replacement and confirmed final table cells',async()=>{
 for(const action of['table.cell_set_text(a,0,0,"changed")','table.clear(a,0,0)','table.delete(a)','table.new(position.top_right,1,1)']){
  const source='var table a=table.new(position.top_right,1,1)\nif barstate.isfirst\n    table.cell(a,0,0,"committed")\nif barstate.isrealtime and close>105\n    '+action,sessionId='tables132-live-'+action.replace(/[^a-z]/gi,'').slice(0,20),req={...request(source,6,false,bars.slice(0,3)),id:sessionId+':0',mode:'live'},executor=pine.createPineLiveExecutor();
  const initial=await executor.execute({protocol:'pine-live-v1',sessionId,sequence:0,action:'start',request:req}),held=structuredClone(initial),tick=(sequence,close,confirmed=false)=>({protocol:'pine-live-v1',sessionId,sequence,action:'update',bar:candle(sequence===4?4:3,close),confirmed});
  const changed=await executor.execute(tick(1,110));assert.notDeepEqual(changed.tables,initial.tables);const restored=await executor.execute(tick(2,95));assert.deepEqual(restored.tables,initial.tables);assert.deepEqual(initial,held);
  const committed=await executor.execute(tick(3,110,true)),next=await executor.execute(tick(4,95));assert.deepEqual(next.tables,committed.tables);executor.dispose();
 }
});

test('table cells retain the cumulative metadata byte budget even when individual strings and allocation dimensions are valid',async()=>{
 const body='var table t=table.new(position.top_right,64,64)',req=request(body),native=await pine.executePineRequest(req);
 const cell={populated:true,text:'x'.repeat(300),width:0,height:0,textColor:'#363a45',textHalign:'center',textValign:'center',textSize:14,bgcolor:null,tooltip:'',textFontFamily:'default',textFormatting:'none'};
 native.tables[0].cells=Array.from({length:64},()=>Array.from({length:64},()=>({...cell})));
 assert.throws(()=>pine.validatePineResponse(response(native,req),req),e=>e.code==='RESULT_LIMIT'&&/metadata|1 MB/.test(e.message));
});


test('ordinary and hidden indicators retain pristine empty table metadata without a blank chart plot, while deleted tables retain cleanup metadata',async()=>{
 const ordinary=await run('plot(close,"Ordinary")');assert.deepEqual(ordinary.tables,[]);assert.equal(ordinary.plots.length,1);assert.equal(pine.adaptPineChartResult(ordinary,bars).plots.length,1);
 const hidden=await run('plot(close,"Hidden",display=display.none)');assert.deepEqual(hidden.tables,[]);assert.deepEqual(pine.adaptPineChartResult(hidden,bars).plots,[]);
 const deleted=await run('var table t=table.new(position.top_right,1,1)\nif barstate.islast\n    table.delete(t)');assert.deepEqual(deleted.tables,[]);assert.deepEqual(pine.adaptPineChartResult(deleted,bars).plots,[]);
});
