import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, platform: "browser", format: "esm", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()], define: { "import.meta.env": "{}" }, stdin: {
  contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";export * from "./frontend/src/lib/pineChartAdapter.ts";export * from "./frontend/src/lib/pineProtocol.ts";',
  resolveDir: new URL("../../", import.meta.url).pathname, loader: "ts", sourcefile: "pine-boxes123-oracles.ts",
} })).outputFiles[0].text;
console.info("PINE_BOXES123_BINDING " + JSON.stringify({ minify: true, sealed: true, bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const start = 1700000040;
const candle = (index, close = 100) => ({ time: start + index * 60, open: close, high: close + 2, low: close - 2, close, volume: 20 });
const bars = Array.from({ length: 12 }, (_, i) => candle(i));
const context = { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const source = (body, version = 6, extra = "") => `//@version=${version}\nindicator("Boxes 123",overlay=false${extra})\n${body}`;
const request = (body, snapshot = bars, version = 6, extra = "") => ({ id: "boxes123", action: "run", source: source(body, version, extra), bars: snapshot, inputs: {}, context });
const run = (body, snapshot = bars, version = 6, extra = "") => pine.executePineRequest(request(body, snapshot, version, extra));
const values = (result, name) => result.plots.find(p => p.name === name).points.map(p => p.value);
function recording() {
  const strokes = [], fills = [], texts = [], clips = [], stack = []; let points = [];
  const ctx = { strokeStyle: "initial", fillStyle: "initial", lineWidth: 1, lineCap: "butt", lineJoin: "miter", lineDashOffset: 0, dash: [], font: "12px sans-serif", textAlign: "left", textBaseline: "alphabetic",
    save() { stack.push({ strokeStyle: this.strokeStyle, fillStyle: this.fillStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin, lineDashOffset: this.lineDashOffset, dash: [...this.dash], font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline }); },
    restore() { Object.assign(this, stack.pop()); }, setLineDash(v) { this.dash = [...v]; }, beginPath() { points = []; }, moveTo(x,y) { points.push([x,y]); }, lineTo(x,y) { points.push([x,y]); }, closePath() {}, rect(x,y,w,h) { points.push([x,y],[x+w,y],[x+w,y+h],[x,y+h]); }, clip() { clips.push([...points]); }, measureText(text) { return { width: [...text].length*8 }; }, fillText(text,x,y,maxWidth) { texts.push({text,x,y,maxWidth,color:this.fillStyle,font:this.font,align:this.textAlign,baseline:this.textBaseline}); }, fillRect(x,y,w,h) { fills.push({points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],color:this.fillStyle}); },
    stroke() { strokes.push({ points: [...points], color: this.strokeStyle, width: this.lineWidth, dash: [...this.dash], cap: this.lineCap }); }, fill() { fills.push({ points: [...points], color: this.fillStyle }); },
  };
  return { ctx, strokes, fills, texts, clips, target: { useMediaCoordinateSpace(fn) { fn({ context: ctx, mediaSize: { width: 200, height: 160 } }); } } };
}
function fixture(result, snapshot = bars, from = 0, to = 11, timeline = snapshot) {
  const adapted = pine.adaptPineChartResult(result, snapshot), listeners = new Set(), removed = [], detached = [], hosts = []; let range = { from, to };
  const indices = new Map(timeline.map((b,i) => [b.time,i]));
  const scale = { getVisibleLogicalRange: () => range, getVisibleRange: () => ({ from: snapshot[Math.max(0, Math.floor(range.from))]?.time, to: snapshot[Math.min(snapshot.length-1, Math.ceil(range.to))]?.time }),
    logicalToCoordinate: i => (i-range.from)*10+20, coordinateToLogical: x => range.from+(x-20)/10, timeToCoordinate: t => indices.has(t) ? (indices.get(t)-range.from)*10+20 : null,
    subscribeVisibleLogicalRangeChange: f => listeners.add(f), unsubscribeVisibleLogicalRangeChange: f => listeners.delete(f), subscribeVisibleTimeRangeChange: f => listeners.add(f), unsubscribeVisibleTimeRangeChange: f => listeners.delete(f) };
  const chart = { timeScale: () => scale, paneSize: () => ({ width: 200, height: 160 }), subscribeSizeChange: f => listeners.add(f), unsubscribeSizeChange: f => listeners.delete(f), removeSeries(s) { removed.push(s); },
    addLineSeries(options) { const host = { data: [], options: () => options, setData(data) { this.data = data; }, priceToCoordinate: y => 150-y, coordinateToPrice: y => 150-y, priceScale: () => ({ options: () => ({ invertScale: false }) }),
      subscribeDataChanged: f => listeners.add(f), unsubscribeDataChanged: f => listeners.delete(f), attachPrimitive(p) { p.attached({ chart, series: this, requestUpdate() {} }); }, detachPrimitive(p) { detached.push(p); p.detached(); } }; hosts.push(host); return host; } };
  const installed = pine.installPineChartPlots(chart, adapted.plots);
  return { adapted, installed, hosts, listeners, removed, detached, pan(a,b) { range = { from:a,to:b }; for(const f of listeners) f(range); }, draw() { const out = recording(), primitive = installed.drawingPrimitive; primitive?.updateAllViews(); for (const view of primitive?.paneViews() ?? []) { const renderer = view.renderer(); renderer?.drawBackground?.(out.target); renderer?.draw?.(out.target); } return out; } };
}
const zone='var box a=box.new(2,110,8,90,border_color=na,bgcolor=#ff000080)';
const shape=b=>[b.left,b.top,b.right,b.bottom,b.xloc,b.extend,b.borderColor,b.borderStyle,b.borderWidth,b.bgcolor,b.text,b.textColor,b.textSize,b.textHalign,b.textValign,b.textWrap,b.textFontFamily,b.textFormatting,b.overlay];
function inside(path,x,y) {let hit=false;for(let i=0,j=path.length-1;i<path.length;j=i++){const a=path[i],b=path[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}

test('v5/v6 genuine default boxes and numeric setters/getters retain exact authored snapshots',async()=>{
 for(const version of[5,6]) {
  const defaults=await run('var box a=box.new(2,110,8,90)',bars,version);
  assert.deepEqual(shape(defaults.boxes[0]),[2,110,8,90,'bar_index','none','#2962ff','solid',1,'#2962ff','','#000000',0,'center','center','none','default','none',false]);
  const result=await run(zone+'\nif bar_index==1\n    box.set_lefttop(a,3,115)\n    a.set_rightbottom(9,85)\nplot(a.get_left(),"Left")\nplot(box.get_right(a),"Right")\nplot(a.get_top(),"Top")\nplot(box.get_bottom(a),"Bottom")',bars,version);
  for(const[name,early,late]of[['Left',2,3],['Right',8,9],['Top',110,115],['Bottom',90,85]])assert.deepEqual(values(result,name),[early,...Array(11).fill(late)]);
  assert.deepEqual(shape(result.boxes[0]).slice(0,4),[3,115,9,85]);assert.ok(!result.diagnostics.some(d=>d.code==='UNSUPPORTED_DRAWING'));
 }
});
test('registered copies remain independent and deleted originals have NA getters, inert setters and honest replay state',async()=>{
 for(const version of[5,6]) for(const call of['box.copy(a)','a.copy()']) {
  const body=zone+'\nvar box b='+call+'\nif bar_index==1\n    b.set_top(120)\nif bar_index==2\n    a.delete()\nif bar_index==3\n    a.set_top(999)\nplot(box.get_top(a),"Original")\nplot(b.get_top(),"Copy")\nplot(array.size(box.all),"Count")';
  const result=await run(body,bars,version);assert.equal(result.boxes.length,1,'v'+version+' '+call);assert.equal(result.boxes[0].top,120);assert.deepEqual(values(result,'Original'),[110,110,...Array(10).fill(null)]);assert.deepEqual(values(result,'Copy'),[110,...Array(11).fill(120)]);assert.deepEqual(values(result,'Count'),[2,2,...Array(10).fill(1)]);
  const early=await run(body,bars.slice(0,2),version);assert.equal(early.boxes.length,2);assert.notEqual(early.boxes[0].id,early.boxes[1].id);assert.equal(early.boxes[0].top,110);
 }
});
test('chart.point and time coordinates preserve native numeric histories and normalize transport milliseconds only',async()=>{
 const indexed=await run('var box a=box.new(chart.point.from_index(2,110),chart.point.from_index(8,90))\na.set_top_left_point(chart.point.from_index(3,115))\na.set_bottom_right_point(chart.point.from_index(9,85))');assert.deepEqual(shape(indexed.boxes[0]).slice(0,5),[3,115,9,85,'bar_index']);
 const timed=await run('var box a=box.new(time,110,time+120000,90,xloc=xloc.bar_time)\nplot(a.get_left(),"Native time")');assert.equal(timed.boxes[0].xloc,'bar_time');assert.equal(timed.boxes[0].left,start);assert.equal(timed.boxes[0].right,start+120);assert.ok(values(timed,'Native time').every(v=>v===start*1000));
 const moved=await run(zone+'\na.set_xloc(time,time+120000,xloc.bar_time)');assert.equal(moved.boxes[0].left,bars.at(-1).time);assert.equal(moved.boxes[0].right,bars.at(-1).time+120);
});
test('text constructor and method fields preserve numeric sizes, wrap, alignment, family and combined formatting',async()=>{
 for(const version of[5,6]) {
  const body='var box a=box.new(2,110,8,90,border_width=0,bgcolor=na,text="Demand zone",text_color=#00ff00,text_size=24,text_halign=text.align_left,text_valign=text.align_top,text_wrap=text.wrap_auto,text_font_family=font.family_monospace,text_formatting=text.format_bold+text.format_italic)';
  const result=await run(body,bars,version),b=result.boxes[0];assert.deepEqual([b.borderWidth,b.bgcolor,b.text,b.textColor,b.textSize,b.textHalign,b.textValign,b.textWrap,b.textFontFamily,b.textFormatting],[0,null,'Demand zone','#00ff00',24,'left','top','auto','monospace','bolditalic']);
  const changed=await run(body+'\na.set_text("Supply\\nzone")\na.set_text_size(size.large)\na.set_text_halign(text.align_right)\na.set_text_valign(text.align_bottom)\na.set_text_wrap(text.wrap_none)\na.set_text_font_family(font.family_default)\na.set_text_formatting(text.format_none)',bars,version),c=changed.boxes[0];assert.deepEqual([c.text,c.textSize,c.textHalign,c.textValign,c.textWrap,c.textFontFamily,c.textFormatting],['Supply\nzone',20,'right','bottom','none','default','none']);
 }
});
test('NA, transparent and incomplete geometry survive transport without phantom paint or range',async()=>{
 for(const version of[5,6]) for(const body of[
 'var box a=box.new(2,110,8,90,bgcolor=na,border_color=color(na),text="Hidden",text_color=na)',
 'var box a=box.new(2,110,8,90,bgcolor=#ff000000,border_color=#ff000000,text="Hidden",text_color=#ff000000)',
 'var box a=box.new(na,110,8,90,bgcolor=#ff0000)']) {
  const result=await run(body,bars,version);assert.equal(result.boxes.length,1);const f=fixture(result),out=f.draw();assert.equal(out.fills.length,0);assert.equal(out.strokes.length,0);assert.equal(out.texts.length,0);assert.equal(f.installed.drawingPrimitive.rangeForVisible(),null);f.installed.dispose();
 }
 for(const call of['a.set_bgcolor(na)','box.set_bgcolor(a,color(na))']){const result=await run(zone+'\n'+call);assert.equal(result.boxes[0].bgcolor,null);const f=fixture(result);assert.equal(f.draw().fills.length,0);f.installed.dispose();}
});
test('finite boxes paint exact independent corners, hidden strokes do not suppress fill, and ownership disposes once',async()=>{
 const result=await run(zone),f=fixture(result),out=f.draw();assert.equal(out.strokes.length,0);assert.ok(out.fills.some(p=>inside(p.points,70,50)));assert.ok(!out.fills.some(p=>inside(p.points,30,50)||inside(p.points,110,50)||inside(p.points,70,30)));assert.ok(out.fills.every(p=>p.points.every(([x,y])=>x>=40&&x<=100&&y>=40&&y<=60)));
 assert.deepEqual(f.hosts[0].data.map(p=>p.time),bars.map(b=>b.time));assert.ok(f.listeners.size>0);f.installed.dispose();f.installed.dispose();assert.equal(f.listeners.size,0);assert.equal(f.removed.length,1);assert.equal(f.detached.length,1);
 const reversed=fixture(await run('var box a=box.new(8,90,2,110,border_color=na,bgcolor=#ff000080)'));assert.ok(reversed.draw().fills.some(p=>inside(p.points,70,50)));reversed.installed.dispose();
});
test('protocol retains immutable exact metadata and rejects getters, unknown fields, duplicate IDs, excess objects and hostile text settings',async()=>{
 const req=request(zone),native=await pine.executePineRequest(req),response=r=>({id:req.id,status:'completed',result:r}),round=pine.validatePineResponse(response(structuredClone(native)),req),held=structuredClone(round.boxes);native.boxes[0].text='changed';assert.deepEqual(round.boxes,held);
 for(const mutate of[r=>r.boxes[0].extra=1,r=>r.boxes[0].id='',r=>r.boxes.push({...r.boxes[0]}),r=>r.boxes[0].left=1.5,r=>r.boxes[0].right=1000,r=>r.boxes[0].xloc='bad',r=>r.boxes[0].top=Infinity,r=>r.boxes[0].borderWidth=17,r=>r.boxes[0].borderWidth=-1,r=>r.boxes[0].borderStyle='arrow_both',r=>r.boxes[0].text='x'.repeat(4097),r=>r.boxes[0].textSize=513,r=>r.boxes[0].textSize=1.5,r=>r.boxes[0].textHalign='justify',r=>r.boxes[0].textFontFamily='url(x)',r=>r.boxes[0].textColor='url(javascript:1)',r=>delete r.boxes[0].textWrap]){const forged=structuredClone(round);mutate(forged);assert.throws(()=>pine.validatePineResponse(response(forged),req));}
 const excessive=structuredClone(round);excessive.boxes=Array.from({length:501},(_,i)=>({...round.boxes[0],id:'box'+i}));assert.throws(()=>pine.validatePineResponse(response(excessive),req));let reads=0;const getter=structuredClone(round);Object.defineProperty(getter.boxes[0],'text',{enumerable:true,get(){reads++;return'x';}});assert.throws(()=>pine.validatePineResponse(response(getter),req));assert.equal(reads,0);
});
test('native FIFO limits retain the newest 500 boxes and constructor limits over 500 fail',async()=>{
 const body='if barstate.isfirst\n    for i=0 to 504\n        box.new(0,100+i,11,90+i,border_color=na)';const result=await run(body,bars,6,',max_boxes_count=500');assert.equal(result.boxes.length,500);assert.equal(result.boxes[0].top,105);assert.equal(result.boxes.at(-1).top,604);await assert.rejects(run(body,bars,6,',max_boxes_count=501'),e=>e.code==='DRAWING_LIMIT');
 const defaults=await run(body);assert.equal(defaults.boxes.length,50);assert.equal(defaults.boxes[0].top,555);
});
test('unsupported native box geometry or styling is omitted with a visible explanation rather than clamped',async()=>{
 for(const args of['border_width=17','border_style=line.style_arrow_both','text_size=513','text_font_family="Comic Sans"','text='+JSON.stringify('x'.repeat(4097))]){const result=await run('var box a=box.new(2,110,8,90,'+args+')');assert.deepEqual(result.boxes??[],[]);assert.ok(result.diagnostics.some(d=>/box/i.test(d.message)&&/unsupported|omit/i.test(d.message)));}
});
test('provisional prior-box setters, deletion and FIFO eviction restore committed payload and helper roots on a no-branch tick',async()=>{
 for(const version of[5,6])for(const action of['a.set_bgcolor(#0000ff80)','a.set_lefttop(3,120)','a.set_text("Transient")','a.set_text_formatting(text.format_bold)','a.delete()','box.new(3,120,9,80)','a.copy()']){
  const body=zone+'\nif barstate.isrealtime and close>105\n    '+action,sessionId='boxes123-live-case-'+version+'-'+['a.set_bgcolor(#0000ff80)','a.set_lefttop(3,120)','a.set_text("Transient")','a.set_text_formatting(text.format_bold)','a.delete()','box.new(3,120,9,80)','a.copy()'].indexOf(action),req={...request(body,bars.slice(0,3),version,',max_boxes_count=1'),mode:'live',id:sessionId+':0'},executor=pine.createPineLiveExecutor();
  const initial=await executor.execute({protocol:'pine-live-v1',sessionId,sequence:0,action:'start',request:req}),saved=structuredClone(initial),command=(sequence,close,confirmed=false)=>({protocol:'pine-live-v1',sessionId,sequence,action:'update',bar:candle(sequence===4?4:3,close),confirmed});
  const changed=await executor.execute(command(1,110)),held=structuredClone(changed);assert.notDeepEqual(changed.boxes,initial.boxes);const restored=await executor.execute(command(2,95));assert.deepEqual(restored.boxes,initial.boxes);assert.deepEqual(initial,saved);assert.deepEqual(changed,held);
  const committed=await executor.execute(command(3,110,true)),next=await executor.execute(command(4,95));assert.deepEqual(next.boxes,committed.boxes);executor.dispose();
 }
});
test('discarded-return box roots remain active and restore after provisional helper compaction and GC',async()=>{
 const body='if bar_index==0\n    box.new(2,110,8,90,border_color=na,bgcolor=#ff000080)\nif barstate.isrealtime and close>105\n    box.new(3,120,9,80,bgcolor=#0000ff80)',sessionId='boxes123-discarded',req={...request(body,bars.slice(0,3),6,',max_boxes_count=1'),mode:'live',id:sessionId+':0'},executor=pine.createPineLiveExecutor();const initial=await executor.execute({protocol:'pine-live-v1',sessionId,sequence:0,action:'start',request:req});assert.equal(initial.boxes.length,1);
 const command=(sequence,close)=>({protocol:'pine-live-v1',sessionId,sequence,action:'update',bar:candle(3,close),confirmed:false});const changed=await executor.execute(command(1,110));assert.equal(changed.boxes[0].bgcolor,'#0000ff80');const restored=await executor.execute(command(2,95));assert.deepEqual(restored.boxes,initial.boxes);executor.dispose();
});
test('text uses explicit authored rectangle alignment, formatting and independent measured wrapping with bounded crop',async()=>{
 for(const[align,x]of[['left',42],['center',70],['right',98]]){
  const f=fixture(await run('var box a=box.new(2,110,8,20,border_color=na,bgcolor=na,text="Demand\\nZone",text_size=12,text_color=#00ff00,text_halign=text.align_'+align+',text_valign=text.align_top,text_font_family=font.family_monospace,text_formatting=text.format_bold+text.format_italic)')),out=f.draw();assert.deepEqual(out.texts.map(t=>t.text),['Demand','Zone']);assert.ok(out.texts.every(t=>t.x===x&&t.font==='italic bold 12px monospace'&&t.color==='#00ff00'&&t.align===align&&t.baseline==='top'));assert.equal(out.texts[0].y,42);assert.equal(out.texts[1].y,56.4);f.installed.dispose();
 }
 const wrapped=fixture(await run('var box a=box.new(2,110,8,20,border_color=na,bgcolor=na,text="1234567890123",text_size=12,text_color=#00ff00,text_halign=text.align_left,text_valign=text.align_top,text_wrap=text.wrap_auto)')),out=wrapped.draw();assert.deepEqual(out.texts.map(t=>t.text),['1234567','890123']);assert.ok(out.clips.some(p=>p.some(([x,y])=>x===40&&y===40)&&p.some(([x,y])=>x===100&&y===130)));wrapped.pan(5,11);const panned=wrapped.draw();assert.equal(panned.texts[0].x,(2-5)*10+20+2);assert.ok(panned.clips.some(p=>p.some(([x])=>x===0)));wrapped.installed.dispose();
});
test('degenerate box borders, dash styles and all extensions follow independent screen line geometry',async()=>{
 for(const[style,dash,cap]of[['solid',[],'butt'],['dashed',[18,12],'butt'],['dotted',[0,6],'round']]){
  const f=fixture(await run('var box a=box.new(2,110,8,90,border_color=#ff0000,bgcolor=na,border_width=3,border_style=line.style_'+style+')')),out=f.draw();assert.equal(out.strokes.length,4);assert.ok(out.strokes.every(p=>p.width===3&&p.color==='#ff0000'&&JSON.stringify(p.dash)===JSON.stringify(dash)&&p.cap===cap));f.installed.dispose();
 }
 for(const body of['var box a=box.new(5,110,5,90,border_color=#ff0000,bgcolor=#ff0000)','var box a=box.new(2,100,8,100,border_color=#ff0000,bgcolor=#ff0000)']){const f=fixture(await run(body)),out=f.draw();assert.equal(out.fills.length,0);assert.equal(out.texts.length,0);assert.equal(out.strokes.length,1);f.installed.dispose();}
 const point=fixture(await run('var box a=box.new(5,100,5,100,border_color=#ff0000,bgcolor=#ff0000)'));assert.equal(point.draw().strokes.length,0);assert.equal(point.installed.drawingPrimitive.rangeForVisible(),null);point.installed.dispose();
});
for(const[setup,receiver]of[
 ['type Holder\n    box item\nvar Holder holder=Holder.new(a)','holder.item'],
 ['var array<box> holders=array.from(a)','array.get(holders,0)'],
 ['read(box value)=>value','read(a)']])test('var method-copy initializes once through '+receiver,async()=>{
 for(const version of[5,6]){const body=zone+'\n'+setup+'\nvar box copied='+receiver+'.copy()\nplot(array.size(box.all),"Count")';const result=await run(body,bars,version);assert.equal(result.boxes.length,2,'v'+version+' '+receiver);assert.ok(values(result,'Count').every(v=>v===2),'v'+version+' '+receiver+' initializes once');}
});
test('non-var instance copies run each bar while var line method-copy keeps its established one-time semantics',async()=>{
 const repeated=await run(zone+'\nbox copied=a.copy()\nplot(array.size(box.all),"Count")');assert.equal(repeated.boxes.length,13);assert.deepEqual(values(repeated,'Count'),Array.from({length:12},(_,i)=>i+2));
 for(const version of[5,6]){const lines=await run('var line a=line.new(2,90,8,110)\nvar line b=a.copy()\nplot(array.size(line.all),"Count")',bars,version);assert.equal(lines.lines.length,2);assert.ok(values(lines,'Count').every(v=>v===2));}
});
