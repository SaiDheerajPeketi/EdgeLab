import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, platform: "browser", format: "esm", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()], define: { "import.meta.env": "{}" }, stdin: {
  contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";export * from "./frontend/src/lib/pineChartAdapter.ts";export * from "./frontend/src/lib/pineProtocol.ts";',
  resolveDir: new URL("../../", import.meta.url).pathname, loader: "ts", sourcefile: "pine-labels124-oracles.ts",
} })).outputFiles[0].text;
console.info("PINE_LABELS124_BINDING " + JSON.stringify({ minify: true, sealed: true, bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const start = 1700000040;
const candle = (index, close = 100) => ({ time: start + index * 60, open: close, high: close + 2, low: close - 2, close, volume: 20 });
const bars = Array.from({ length: 12 }, (_, i) => candle(i));
const context = { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const source = (body, version = 6, extra = "") => `//@version=${version}\nindicator("Labels 124",overlay=false${extra})\n${body}`;
const request = (body, snapshot = bars, version = 6, extra = "") => ({ id: "labels124", action: "run", source: source(body, version, extra), bars: snapshot, inputs: {}, context });
const run = (body, snapshot = bars, version = 6, extra = "") => pine.executePineRequest(request(body, snapshot, version, extra));
const values = (result, name) => result.plots.find(p => p.name === name).points.map(p => p.value);
function recording() {
  const strokes = [], fills = [], texts = [], clips = [], stack = []; let points = [];
  const ctx = { strokeStyle: "initial", fillStyle: "initial", lineWidth: 1, lineCap: "butt", lineJoin: "miter", lineDashOffset: 0, dash: [], tx: 0, ty: 0, font: "12px sans-serif", textAlign: "left", textBaseline: "alphabetic",
    save() { stack.push({ strokeStyle: this.strokeStyle, fillStyle: this.fillStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin, lineDashOffset: this.lineDashOffset, dash: [...this.dash], tx: this.tx, ty: this.ty, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline }); },
    restore() { Object.assign(this, stack.pop()); }, setLineDash(v) { this.dash = [...v]; }, beginPath() { points = []; }, moveTo(x,y) { points.push([x+this.tx,y+this.ty]); }, lineTo(x,y) { points.push([x+this.tx,y+this.ty]); }, closePath() {}, rect(x,y,w,h) { points.push([x,y],[x+w,y],[x+w,y+h],[x,y+h]); }, clip() { clips.push([...points]); }, translate(x,y) { this.tx+=x; this.ty+=y; }, ellipse(x,y,rx,ry) { for(let i=0;i<32;i++)points.push([this.tx+x+rx*Math.cos(i*Math.PI/16),this.ty+y+ry*Math.sin(i*Math.PI/16)]); }, measureText(text) {const width=[...text].length*8,left=this.textAlign==="right"?width:this.textAlign==="center"?width/2:0;return {width,actualBoundingBoxLeft:left,actualBoundingBoxRight:width-left,actualBoundingBoxAscent:0,actualBoundingBoxDescent:12};}, strokeText(text,x,y) {strokes.push({text,x:x+this.tx,y:y+this.ty,color:this.strokeStyle,font:this.font});}, fillText(text,x,y,maxWidth) { texts.push({text,x:x+this.tx,y:y+this.ty,maxWidth,color:this.fillStyle,font:this.font,align:this.textAlign,baseline:this.textBaseline}); }, fillRect(x,y,w,h) { fills.push({points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],color:this.fillStyle}); },
    stroke() { strokes.push({ points: [...points], color: this.strokeStyle, width: this.lineWidth, dash: [...this.dash], cap: this.lineCap }); }, fill() { fills.push({ points: [...points], color: this.fillStyle }); },
  };
  return { ctx, strokes, fills, texts, clips, target: { useMediaCoordinateSpace(fn) { fn({ context: ctx, mediaSize: { width: 200, height: 160 } }); } } };
}
function fixture(result, snapshot = bars, from = 0, to = 11, timeline = snapshot) {
  const adapted = pine.adaptPineChartResult(result, snapshot), listeners = new Set(), removed = [], detached = [], hosts = []; let range = { from, to };
  const indices = new Map(timeline.map((b,i) => [b.time,i]));
  const scale = { width:()=>200,getVisibleLogicalRange: () => range, getVisibleRange: () => ({ from: snapshot[Math.max(0, Math.floor(range.from))]?.time, to: snapshot[Math.min(snapshot.length-1, Math.ceil(range.to))]?.time }),
    logicalToCoordinate: i => (i-range.from)*10+20, coordinateToLogical: x => range.from+(x-20)/10, timeToCoordinate: t => indices.has(t) ? (indices.get(t)-range.from)*10+20 : null,
    subscribeVisibleLogicalRangeChange: f => listeners.add(f), unsubscribeVisibleLogicalRangeChange: f => listeners.delete(f), subscribeVisibleTimeRangeChange: f => listeners.add(f), unsubscribeVisibleTimeRangeChange: f => listeners.delete(f) };
  const element={addEventListener:(type,f)=>listeners.add(f),removeEventListener:(type,f)=>listeners.delete(f),append() {}};
  const chart = { chartElement:()=>element,subscribeCrosshairMove:f=>listeners.add(f),unsubscribeCrosshairMove:f=>listeners.delete(f),timeScale: () => scale, paneSize: () => ({ width: 200, height: 160 }), subscribeSizeChange: f => listeners.add(f), unsubscribeSizeChange: f => listeners.delete(f), removeSeries(s) { removed.push(s); },
    addLineSeries(options) { const host = { data: [], options: () => options, setData(data) { this.data = data; }, priceToCoordinate: y => 150-y, coordinateToPrice: y => 150-y, priceScale: () => ({ options: () => ({ invertScale: false }) }),
      subscribeDataChanged: f => listeners.add(f), unsubscribeDataChanged: f => listeners.delete(f), attachPrimitive(p) { p.attached({ chart, series: this, requestUpdate() {} }); }, detachPrimitive(p) { detached.push(p); p.detached(); } }; hosts.push(host); return host; } };
  const installed = pine.installPineChartPlots(chart, adapted.plots);
  return { adapted, installed, hosts, listeners, removed, detached, pan(a,b) { range = { from:a,to:b }; for(const f of listeners) f(range); }, draw() { const out = recording(), primitive = installed.drawingPrimitive; primitive?.updateAllViews(); for (const view of primitive?.paneViews() ?? []) { const renderer = view.renderer(); renderer?.drawBackground?.(out.target); renderer?.draw?.(out.target); } return out; } };
}
const tag='var label a=label.new(5,100,"Demand",color=#ff000080,textcolor=#00ff00,style=label.style_label_center)';
const fields=l=>[l.x,l.y,l.xloc,l.yloc,l.color,l.style,l.text,l.textColor,l.textSize,l.textAlign,l.tooltip,l.textFontFamily,l.textFormatting,l.overlay,l.forceOverlay];
const styles=['label_down','label_up','label_left','label_right','label_lower_left','label_lower_right','label_upper_left','label_upper_right','label_center','circle','square','diamond','flag','arrowup','arrowdown','cross','xcross','triangleup','triangledown','none','text_outline'];

test('v5/v6 labels retain native defaults and numeric/string getter histories through static and method mutations',async()=>{
 for(const version of[5,6]){
  const defaults=await run('var label a=label.new(5,100)',bars,version),l=defaults.labels[0];assert.deepEqual([l.x,l.y,l.xloc,l.yloc,l.style,l.text,l.textSize,l.textAlign,l.tooltip,l.textFontFamily,l.textFormatting,l.overlay,l.forceOverlay],[5,100,'bar_index','price','label_down','',12,'center','','default','none',false,false]);assert.ok(typeof l.color==='string'&&l.color.length>0);assert.ok(typeof l.textColor==='string'&&l.textColor.length>0);
  const result=await run(tag+'\nif bar_index==1\n    label.set_xy(a,6,110)\n    a.set_text("Supply")\nplot(a.get_x(),"X")\nplot(label.get_y(a),"Y")\nplot(str.length(label.get_text(a)),"Text length")',bars,version);
  assert.deepEqual(values(result,'X'),[5,...Array(11).fill(6)]);assert.deepEqual(values(result,'Y'),[100,...Array(11).fill(110)]);assert.deepEqual(values(result,'Text length'),Array(12).fill(6));assert.deepEqual(fields(result.labels[0]).slice(0,7),[6,110,'bar_index','price','#ff000080','label_center','Supply']);assert.ok(!result.diagnostics.some(d=>d.code==='UNSUPPORTED_DRAWING'));
 }
});
test('registered label copies retain independent payloads, deleted labels have NA getters and final replay snapshots clear',async()=>{
 for(const version of[5,6])for(const call of['label.copy(a)','a.copy()']){
  const body=tag+'\nvar label b='+call+'\nif bar_index==1\n    b.set_text("Copy")\n    b.set_y(110)\nif bar_index==2\n    a.delete()\nif bar_index==3\n    a.set_text("Bad")\nplot(a.get_y(),"Original")\nplot(str.length(a.get_text()),"Original text")\nplot(b.get_y(),"Copy")\nplot(array.size(label.all),"Count")',result=await run(body,bars,version);
  assert.equal(result.labels.length,1,'v'+version+' '+call);assert.equal(result.labels[0].text,'Copy');assert.deepEqual(values(result,'Original'),[100,100,...Array(10).fill(null)]);assert.deepEqual(values(result,'Original text'),[6,6,...Array(10).fill(0)]);assert.deepEqual(values(result,'Copy'),[100,...Array(11).fill(110)]);assert.deepEqual(values(result,'Count'),[2,2,...Array(10).fill(1)]);assert.equal((await run(body,bars.slice(0,2),version)).labels.length,2);
  const erased=await run(tag+'\na.delete()',bars,version);assert.deepEqual(erased.labels,[]);
 }
});
test('native label chart.point and time getters preserve milliseconds while final transport normalizes seconds',async()=>{
 const indexed=await run('var label a=label.new(chart.point.from_index(2,110),"Point")\na.set_point(chart.point.from_index(8,90))');assert.deepEqual(fields(indexed.labels[0]).slice(0,4),[8,90,'bar_index','price']);
 const timed=await run('var label a=label.new(time,100,"Time",xloc=xloc.bar_time)\nplot(a.get_x(),"Native")');assert.equal(timed.labels[0].x,start);assert.ok(values(timed,'Native').every(v=>v===start*1000));
 const shifted=await run(tag+'\na.set_xloc(time+30000,xloc.bar_time)');assert.equal(shifted.labels[0].x,bars.at(-1).time+30);assert.equal(shifted.labels[0].xloc,'bar_time');
});
test('all21 native styles, label-specific string sizes and numeric constructor/setter inputs are faithfully transported',async()=>{
 for(const style of styles){const result=await run('var label a=label.new(5,100,"Demand",style=label.style_'+style+',color=#ff0000,textcolor=#00ff00)');assert.equal(result.labels[0].style,style);}
 for(const[size,pixels]of[['auto',0],['tiny',7],['small',10],['normal',12],['large',18],['huge',24]]){const result=await run('var label a=label.new(5,100,"Demand",size=size.'+size+')');assert.equal(result.labels[0].textSize,pixels);}
 for(const version of[5,6]){
  const body='position=input.int(6,"Position")\nsizeInput=input.int(25,"Text size")\nshade=input.color(#ff0000,"Shade")\nvar label a=label.new(5,100,"Demand",size=24,text_font_family=font.family_monospace,text_formatting=text.format_bold+text.format_italic)\na.set_x(position)\nlabel.set_size(a,sizeInput)\na.set_color(shade)\na.set_textalign(text.align_right)\na.set_tooltip("Demand\\nVerified")',result=await run(body,bars,version);assert.deepEqual([result.labels[0].x,result.labels[0].textSize,result.labels[0].color,result.labels[0].textAlign,result.labels[0].tooltip,result.labels[0].textFontFamily,result.labels[0].textFormatting],[6,25,'#ff0000','right','Demand\nVerified','monospace','bolditalic']);
 }
});
test('NA colors remain independently hidden and relative labels preserve ignored NA price coordinates',async()=>{
 for(const version of[5,6])for(const yloc of['abovebar','belowbar']){const result=await run('var label a=label.new(5,na,"Demand",yloc=yloc.'+yloc+',color=na,textcolor=color(na))',bars,version);assert.equal(result.labels[0].y,null);assert.equal(result.labels[0].yloc,yloc);assert.equal(result.labels[0].color,null);assert.equal(result.labels[0].textColor,null);}
 for(const method of['a.set_color(na)','label.set_color(a,color(na))']){const result=await run(tag+'\n'+method);assert.equal(result.labels[0].color,null);assert.equal(result.labels[0].textColor,'#00ff00');}
 const hidden=await run('var label a=label.new(na,na,"Hidden",color=#ff0000,textcolor=#00ff00)');assert.equal(hidden.labels[0].x,null);assert.equal(hidden.labels[0].y,null);
});
test('strict16-field label protocol copies metadata and rejects hostile or malformed fields without executing getters',async()=>{
 const req=request(tag),native=await pine.executePineRequest(req),response=r=>({id:req.id,status:'completed',result:r}),round=pine.validatePineResponse(response(structuredClone(native)),req),held=structuredClone(round.labels);native.labels[0].tooltip='changed';assert.deepEqual(round.labels,held);
 for(const mutate of[r=>r.labels[0].extra=1,r=>r.labels[0].id='',r=>r.labels.push({...r.labels[0]}),r=>r.labels[0].x=1.5,r=>r.labels[0].x=1000,r=>r.labels[0].yloc='top',r=>r.labels[0].y=Infinity,r=>r.labels[0].style='circle<script>',r=>r.labels[0].color='url(javascript:1)',r=>r.labels[0].text='x'.repeat(4097),r=>r.labels[0].tooltip='x'.repeat(4097),r=>r.labels[0].textSize=513,r=>r.labels[0].textSize=1.5,r=>r.labels[0].textAlign='justify',r=>r.labels[0].textFontFamily='url(x)',r=>delete r.labels[0].tooltip,r=>delete r.labels[0].forceOverlay,r=>r.labels[0].forceOverlay=true]){const forged=structuredClone(round);mutate(forged);assert.throws(()=>pine.validatePineResponse(response(forged),req));}
 let reads=0;const getter=structuredClone(round);Object.defineProperty(getter.labels[0],'text',{enumerable:true,get(){reads++;return'x';}});assert.throws(()=>pine.validatePineResponse(response(getter),req));assert.equal(reads,0);const excessive=structuredClone(round);excessive.labels=Array.from({length:501},(_,i)=>({...round.labels[0],id:'label'+i}));assert.throws(()=>pine.validatePineResponse(response(excessive),req));
});
test('native FIFO retains newest500 labels independently, default50 applies, and declarations exceeding500 fail honestly',async()=>{
 const body='if barstate.isfirst\n    for i=0 to 504\n        label.new(5,100+i,str.tostring(i),color=na)',result=await run(body,bars,6,',max_labels_count=500');assert.equal(result.labels.length,500);assert.equal(result.labels[0].text,'5');assert.equal(result.labels.at(-1).text,'504');const defaults=await run(body);assert.equal(defaults.labels.length,50);assert.equal(defaults.labels[0].text,'455');await assert.rejects(run(body,bars,6,',max_labels_count=501'),e=>e.code==='DRAWING_LIMIT');
});
test('unsupported native label settings produce explicit omission rather than fabricated styles or clamped sizes',async()=>{
 for(const args of['size=513','style="Unknown"','text_font_family="Comic Sans"','text='+JSON.stringify('x'.repeat(4097)),'tooltip='+JSON.stringify('x'.repeat(4097))]){const result=await run('var label a=label.new(5,100,'+args+')');assert.deepEqual(result.labels??[],[]);assert.ok(result.diagnostics.some(d=>/label/i.test(d.message)&&/unsupported|omit/i.test(d.message)));}
});
test('provisional prior-label payload, copy, delete and FIFO eviction restore on a no-branch tick and only confirmed updates persist',async()=>{
 const actions=['a.set_color(#0000ff80)','a.set_text("Transient")','a.set_xy(6,120)','a.set_yloc(yloc.abovebar)','a.set_size(24)','a.set_style(label.style_square)','a.set_tooltip("Transient tip")','a.set_text_formatting(text.format_bold)','a.delete()','label.new(6,120,"New")','a.copy()'];
 for(const version of[5,6])for(const[index,action]of actions.entries()){
  const body=tag+'\nif barstate.isrealtime and close>105\n    '+action,sessionId='labels124-live-case-'+version+'-'+index,req={...request(body,bars.slice(0,3),version,',max_labels_count=1'),mode:'live',id:sessionId+':0'},executor=pine.createPineLiveExecutor(),initial=await executor.execute({protocol:'pine-live-v1',sessionId,sequence:0,action:'start',request:req}),saved=structuredClone(initial),command=(sequence,close,confirmed=false)=>({protocol:'pine-live-v1',sessionId,sequence,action:'update',bar:candle(sequence===4?4:3,close),confirmed});
  const changed=await executor.execute(command(1,110)),held=structuredClone(changed);assert.notDeepEqual(changed.labels,initial.labels,'v'+version+' '+action);const restored=await executor.execute(command(2,95));assert.deepEqual(restored.labels,initial.labels);assert.deepEqual(initial,saved);assert.deepEqual(changed,held);const committed=await executor.execute(command(3,110,true)),next=await executor.execute(command(4,95));assert.deepEqual(next.labels,committed.labels);executor.dispose();
 }
});
test('discarded-return label roots restore after provisional compaction and GC with original text and object identity',async()=>{
 const body='if bar_index==0\n    label.new(5,100,"Demand",color=#ff0000)\nif barstate.isrealtime and close>105\n    label.new(6,120,"New",color=#0000ff)',sessionId='labels124-discarded',req={...request(body,bars.slice(0,3),6,',max_labels_count=1'),mode:'live',id:sessionId+':0'},executor=pine.createPineLiveExecutor(),initial=await executor.execute({protocol:'pine-live-v1',sessionId,sequence:0,action:'start',request:req}),command=(sequence,close)=>({protocol:'pine-live-v1',sessionId,sequence,action:'update',bar:candle(3,close),confirmed:false});const changed=await executor.execute(command(1,110));assert.equal(changed.labels[0].text,'New');const restored=await executor.execute(command(2,95));assert.deepEqual(restored.labels,initial.labels);executor.dispose();
});
for(const[setup,receiver]of[['type Holder\n    label item\nvar Holder holder=Holder.new(a)','holder.item'],['var array<label> holders=array.from(a)','array.get(holders,0)'],['read(label value)=>value','read(a)']])test('label var method-copy initializes once through '+receiver,async()=>{
 for(const version of[5,6]){const result=await run(tag+'\n'+setup+'\nvar label b='+receiver+'.copy()\nplot(array.size(label.all),"Count")',bars,version);assert.equal(result.labels.length,2);assert.ok(values(result,'Count').every(v=>v===2));}
});
test('non-var label copy runs on every bar while a var factory-return receiver is evaluated once',async()=>{
 const repeated=await run(tag+'\nlabel b=a.copy()\nplot(array.size(label.all),"Count")');assert.equal(repeated.labels.length,13);assert.deepEqual(values(repeated,'Count'),Array.from({length:12},(_,i)=>i+2));const once=await run('make()=>label.new(5,100,"Demand")\nvar label b=make().copy()\nplot(array.size(label.all),"Count")');assert.equal(once.labels.length,2);assert.ok(values(once,'Count').every(v=>v===2));
});
test('chart.point default index location hides time-only points and NA text or tooltip clears only their authored payload',async()=>{
 for(const version of[5,6]){
  const unindexed=await run('var label a=label.new(chart.point.from_time(time,100),"Time point")',bars,version);assert.equal(unindexed.labels[0].xloc,'bar_index');assert.equal(unindexed.labels[0].x,null);
  const explicit=await run('var label a=label.new(chart.point.from_time(time,100),"Time point",xloc=xloc.bar_time)',bars,version);assert.equal(explicit.labels[0].xloc,'bar_time');assert.equal(explicit.labels[0].x,start);
  for(const call of['a.set_text(na)\na.set_tooltip(na)','label.set_text(a,na)\nlabel.set_tooltip(a,na)']){const result=await run(tag+'\n'+call,bars,version);assert.equal(result.labels[0].text,'');assert.equal(result.labels[0].tooltip,'');assert.equal(result.labels[0].color,'#ff000080');}
 }
});
function inside(path,x,y){let hit=false;for(let i=0,j=path.length-1;i<path.length;j=i++){const a=path[i],b=path[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function measuredFixture(result){const measurement=recording(),previous=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>measurement.ctx})};try{return fixture(result);}finally{globalThis.document=previous;}}
function measuredDraw(f){const measurement=recording(),previous=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>measurement.ctx})};try{return f.draw();}finally{globalThis.document=previous;}}
test('genuine label polygons respect independently located anchors and relative NA locations require an actual candle',async()=>{
 for(const style of['label_down','label_up','label_left','label_right','label_center','circle','square','diamond']){
  const f=measuredFixture(await run('var label a=label.new(5,100,"",color=#ff0000,textcolor=na,style=label.style_'+style+')')),out=measuredDraw(f);assert.equal(out.fills.length,1,style);const points=out.fills[0].points;
  if(style==='label_down')assert.ok(points.every(([,y])=>y<=50)&&points.some(([,y])=>y<50));if(style==='label_up')assert.ok(points.every(([,y])=>y>=50)&&points.some(([,y])=>y>50));if(style==='label_left')assert.ok(points.every(([x])=>x>=70)&&points.some(([x])=>x>70));if(style==='label_right')assert.ok(points.every(([x])=>x<=70)&&points.some(([x])=>x<70));if(['label_center','circle','square','diamond'].includes(style))assert.ok(inside(points,70,50));f.installed.dispose();assert.equal(f.listeners.size,0);assert.equal(f.removed.length,1);
 }
 for(const[yloc,y]of[['abovebar',Math.min(150-102,150-98)-12],['belowbar',Math.max(150-102,150-98)+12]]){const f=measuredFixture(await run('var label a=label.new(5,na,"",yloc=yloc.'+yloc+',color=#ff0000,textcolor=na,style=label.style_label_center)')),out=measuredDraw(f);assert.ok(out.fills.some(p=>inside(p.points,70,y)));f.installed.dispose();}
 const missing=measuredFixture(await run('var label a=label.new(20,na,"",yloc=yloc.abovebar,color=#ff0000,style=label.style_label_center)'));assert.equal(measuredDraw(missing).fills.length,0);missing.installed.dispose();
});
test('multiline label text and invisible bodies use explicit fonts and independent glyph advances without phantom shapes',async()=>{
 for(const style of['none','label_center']){const f=measuredFixture(await run('var label a=label.new(5,100,"Demand\\nZone",color=na,textcolor=#00ff00,size=18,text_font_family=font.family_monospace,text_formatting=text.format_bold+text.format_italic,style=label.style_'+style+')')),out=measuredDraw(f);assert.equal(out.fills.length,0);assert.deepEqual(out.texts.map(t=>t.text),['Demand','Zone']);assert.ok(out.texts.every(t=>t.font==='italic bold 18px monospace'&&t.color==='#00ff00'));assert.ok(Math.abs(out.texts[1].y-out.texts[0].y-18*1.2)<1e-12);f.installed.dispose();}
});
test('positional NA text and tooltip preserve both overloads without shifting styles, size, colors or forceOverlay',async()=>{
 for(const version of[5,6]){
  const indexed=await run('var label a=label.new(5,100,na,xloc.bar_index,yloc.price,na,label.style_circle,na,size.large,text.align_left,na,font.family_monospace,true,text.format_bold)',bars,version),a=indexed.labels[0];assert.deepEqual([a.x,a.y,a.text,a.tooltip,a.color,a.textColor,a.style,a.textSize,a.textAlign,a.textFontFamily,a.textFormatting,a.forceOverlay,a.overlay],[5,100,'','',null,null,'circle',18,'left','monospace','bold',true,true]);
  const pointed=await run('var label a=label.new(chart.point.from_time(time,100),na,xloc.bar_time,yloc.price,#ff0000,label.style_circle,na,18,text.align_right,na,font.family_monospace,false,text.format_bold)',bars,version),b=pointed.labels[0];assert.deepEqual([b.x,b.y,b.xloc,b.text,b.tooltip,b.style,b.textSize,b.textAlign,b.forceOverlay,b.overlay],[start,100,'bar_time','','','circle',18,'right',false,false]);
 }
});
