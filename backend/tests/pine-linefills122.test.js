import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, platform: "browser", format: "esm", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()], define: { "import.meta.env": "{}" }, stdin: {
  contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";export * from "./frontend/src/lib/pineChartAdapter.ts";export * from "./frontend/src/lib/pineProtocol.ts";',
  resolveDir: new URL("../../", import.meta.url).pathname, loader: "ts", sourcefile: "pine-linefills122-oracles.ts",
} })).outputFiles[0].text;
console.info("PINE_LINEFILLS122_BINDING " + JSON.stringify({ minify: true, sealed: true, bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const start = 1700000040;
const candle = (index, close = 100) => ({ time: start + index * 60, open: close, high: close + 2, low: close - 2, close, volume: 20 });
const bars = Array.from({ length: 12 }, (_, i) => candle(i));
const context = { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const source = (body, version = 6, extra = "") => `//@version=${version}\nindicator("Line fills 122",overlay=false${extra})\n${body}`;
const request = (body, snapshot = bars, version = 6, extra = "") => ({ id: "linefills122", action: "run", source: source(body, version, extra), bars: snapshot, inputs: {}, context });
const run = (body, snapshot = bars, version = 6, extra = "") => pine.executePineRequest(request(body, snapshot, version, extra));
const geometry = line => [line.x1, line.y1, line.x2, line.y2, line.xloc, line.extend, line.color, line.style, line.width, line.overlay];
const values = (result, name) => result.plots.find(p => p.name === name).points.map(p => p.value);
const defaultLine = 'var line a=line.new(2,90,8,110,color=#ff0000,width=2)';
function recording() {
  const strokes = [], fills = [], stack = []; let points = [];
  const ctx = { strokeStyle: "initial", fillStyle: "initial", lineWidth: 1, lineCap: "butt", lineJoin: "miter", lineDashOffset: 0, dash: [],
    save() { stack.push({ strokeStyle: this.strokeStyle, fillStyle: this.fillStyle, lineWidth: this.lineWidth, lineCap: this.lineCap, lineJoin: this.lineJoin, lineDashOffset: this.lineDashOffset, dash: [...this.dash] }); },
    restore() { Object.assign(this, stack.pop()); }, setLineDash(v) { this.dash = [...v]; }, beginPath() { points = []; }, moveTo(x,y) { points.push([x,y]); }, lineTo(x,y) { points.push([x,y]); }, closePath() {}, rect() {}, clip() {},
    stroke() { strokes.push({ points: [...points], color: this.strokeStyle, width: this.lineWidth, dash: [...this.dash], cap: this.lineCap }); }, fill() { fills.push({ points: [...points], color: this.fillStyle }); },
  };
  return { ctx, strokes, fills, target: { useMediaCoordinateSpace(fn) { fn({ context: ctx, mediaSize: { width: 200, height: 160 } }); } } };
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


const boundaries='var line a=line.new(2,90,8,90,color=na)\nvar line b=line.new(2,110,8,110,color=na)';
const channel=boundaries+'\nvar linefill f=linefill.new(a,b,#ff000080)';
const fillShape=f=>[f.line1,f.line2,f.color,f.overlay];
function inside(path,x,y) { let hit=false; for(let i=0,j=path.length-1;i<path.length;j=i++) {const a=path[i],b=path[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;} return hit; }

test("v5/v6 final line fills retain boundary identity and numeric getters while transparent lines do not suppress their channel",async()=>{
 for(const version of[5,6]) {
  const result=await run(channel+'\nif bar_index==1\n    line.set_y2(linefill.get_line1(f),95)\nplot(line.get_y2(linefill.get_line1(f)),"Boundary")',bars,version);
  assert.equal(result.lineFills.length,1);assert.deepEqual(fillShape(result.lineFills[0]),[result.lines[0].id,result.lines[1].id,"#ff000080",false]);
  assert.deepEqual(values(result,"Boundary"),[90,...Array(11).fill(95)]);assert.equal(result.lines[0].y2,95);
  assert.ok(!result.diagnostics.some(d=>d.code==="UNSUPPORTED_DRAWING"));
  const f=fixture(result),out=f.draw();assert.equal(out.strokes.length,0);assert.ok(out.fills.some(p=>inside(p.points,70,50)));assert.ok(out.fills.every(p=>p.color==="#ff000080"));f.installed.dispose();
 }
});
test("same ordered or reversed pair replacement allocates a new fill ID and makes the old fill setter inert",async()=>{
 for(const version of[5,6]) {
  const early=await run(channel,bars.slice(0,1),version),body=channel+'\nif bar_index==1\n    linefill.new(b,a,#0000ff80)\nif bar_index==2\n    f.set_color(#00ff0080)\nplot(array.indexof(linefill.all,f),"Old active")';
  const result=await run(body,bars,version);assert.equal(result.lineFills.length,1);assert.equal(result.lineFills[0].color,"#0000ff80");
  assert.deepEqual(values(result,"Old active"),[0,...Array(11).fill(-1)]);assert.notEqual(result.lineFills[0].id,early.lineFills[0].id);
  const latest=await run(channel+'\nlinefill.new(a,b,#0000ff80)\nplot(array.size(linefill.all),"Count")',bars,version);assert.equal(latest.lineFills.length,1);assert.ok(values(latest,"Count").every(v=>v===1));
 }
});
test("explicit fill deletion and boundary deletion or line GC cascade to active fills",async()=>{
 for(const version of[5,6]) for(const action of['f.delete()','a.delete()','line.new(3,100,8,100,color=na)']) {
  const body=channel+'\nif bar_index==2\n    '+action+'\nplot(array.size(linefill.all),"Count")',result=await run(body,bars,version,',max_lines_count=2');
  assert.deepEqual(result.lineFills??[],[]);assert.deepEqual(values(result,"Count"),[1,1,...Array(10).fill(0)]);
  assert.equal((await run(body,bars.slice(0,2),version,',max_lines_count=2')).lineFills.length,1);
 }
});
test("static and method NA colors remain hidden and unsupported boundary settings are honestly omitted",async()=>{
 for(const version of[5,6]) for(const action of['linefill.set_color(f,na)','linefill.set_color(f,color(na))','f.set_color(na)','f.set_color(color(na))']) {
  const result=await run(channel+'\nif bar_index==1\n    '+action,bars,version);assert.equal(result.lineFills[0].color,null);
  const f=fixture(result);assert.equal(f.draw().fills.length,0);assert.equal(f.installed.drawingPrimitive.rangeForVisible(),null);f.installed.dispose();
 }
 const result=await run(channel.replace('color=na','color=na,width=17'));assert.deepEqual(result.lineFills??[],[]);assert.ok(result.diagnostics.some(d=>/fill|line/i.test(d.message)&&/unsupported|unavailable|omit/i.test(d.message)));
});
test("fill polygons use only common horizontal span and split crossing lobes without alpha overlap",async()=>{
 const result=await run('var line a=line.new(2,90,8,110,color=na)\nvar line b=line.new(2,110,8,90,color=na)\nvar linefill f=linefill.new(a,b,#ff000080)'),f=fixture(result),paint=f.draw().fills;
 assert.equal(paint.length,2);assert.equal(paint.filter(p=>inside(p.points,50,50)).length,1);assert.equal(paint.filter(p=>inside(p.points,90,50)).length,1);assert.equal(paint.filter(p=>inside(p.points,70,42)).length,0);
 assert.ok(paint.every(p=>p.points.every(([x])=>x>=40&&x<=100)));f.installed.dispose();
 const separate=fixture(await run('var line a=line.new(2,90,4,90,color=na)\nvar line b=line.new(6,110,8,110,color=na)\nlinefill.new(a,b,#ff000080)'));assert.equal(separate.draw().fills.length,0);separate.installed.dispose();
 const partial=fixture(await run('var line a=line.new(2,90,8,90,color=na)\nvar line b=line.new(4,110,10,110,color=na)\nlinefill.new(a,b,#ff000080)'));const p=partial.draw().fills;assert.ok(p.some(p=>inside(p.points,70,50)));assert.ok(!p.some(p=>inside(p.points,50,50)||inside(p.points,110,50)));partial.installed.dispose();
});
test("fill extensions require both boundaries to share that direction; non-overlap and vertical boundaries have no area",async()=>{
 for(const [first,second,left,right]of[["right","right",false,true],["both","right",false,true],["both","left",true,false],["left","right",false,false],["none","both",false,false]]) {
  const f=fixture(await run(channel+'\na.set_extend(extend.'+first+')\nb.set_extend(extend.'+second+')')),paint=f.draw().fills;
  assert.equal(paint.some(p=>inside(p.points,20,50)),left);assert.equal(paint.some(p=>inside(p.points,140,50)),right);assert.ok(paint.some(p=>inside(p.points,70,50)));f.installed.dispose();
 }
 const vertical=fixture(await run('var line a=line.new(5,90,5,110,color=na)\nvar line b=line.new(5,95,5,115,color=na)\nlinefill.new(a,b,#ff000080)'));assert.equal(vertical.draw().fills.length,0);vertical.installed.dispose();
});
test("mixed-pane boundary fills are preserved with an honest visible omission notice",async()=>{
 const result=await run(channel.replace('var line b=line.new(2,110,8,110,color=na)','var line b=line.new(2,110,8,110,color=na,force_overlay=true)'));
 assert.equal(result.lineFills[0].overlay,true);assert.deepEqual(result.lines.map(l=>l.overlay),[false,true]);
 const f=fixture(result);assert.equal(f.draw().fills.length,0);assert.ok(f.adapted.warnings.some(w=>/fill/i.test(w)&&/pane|placement/i.test(w)));f.installed.dispose();
});
test("protocol copies valid fill references and rejects missing IDs, duplicate unordered pairs, malformed fields and excess objects",async()=>{
 const req=request(channel),native=await pine.executePineRequest(req),response=r=>({id:req.id,status:"completed",result:r}),round=pine.validatePineResponse(response(structuredClone(native)),req),snapshot=structuredClone(round.lineFills);
 native.lineFills[0].color="#0000ff";assert.deepEqual(round.lineFills,snapshot);
 for(const mutate of[r=>r.lineFills[0].line1="missing",r=>r.lineFills[0].overlay=true,r=>r.lineFills[0].extra=true,r=>r.lineFills[0].id="",r=>r.lineFills[0].color="url(javascript:1)",r=>delete r.lineFills[0].color,r=>r.lineFills.push({...r.lineFills[0],id:"another",line1:r.lineFills[0].line2,line2:r.lineFills[0].line1})]) {
  const forged=structuredClone(round);mutate(forged);assert.throws(()=>pine.validatePineResponse(response(forged),req));
 }
 const excessive=structuredClone(round);excessive.lineFills=Array.from({length:501},(_,i)=>({...round.lineFills[0],id:"fill"+i}));assert.throws(()=>pine.validatePineResponse(response(excessive),req));
 let reads=0;const getter=structuredClone(round);Object.defineProperty(getter.lineFills[0],"color",{enumerable:true,get(){reads++;return"#ff0000";}});assert.throws(()=>pine.validatePineResponse(response(getter),req));assert.equal(reads,0);
 const packedBars=Array.from({length:5000},(_,i)=>candle(i)),packed=await run(channel+'\nplot(close,"Packed")',packedBars);assert.equal(packed.lineFills.length,1);assert.equal(packed.plots[0].points.length,5000);
});
test("native fill transport enforces 500 active fills independently of line count",async()=>{
 const body='var array<line> guides=array.new_line()\nif barstate.isfirst\n    for i=0 to 32\n        array.push(guides,line.new(0,90+i,11,90+i,color=na))\n    for i=0 to 31\n        for j=i+1 to 32\n            linefill.new(array.get(guides,i),array.get(guides,j),#ff000080)';
 const result=await run(body,bars,6,',max_lines_count=500');assert.equal(result.lines.length,33);assert.equal(result.lineFills.length,500);
 await assert.rejects(run(body,bars,6,',max_lines_count=501'),e=>e.code==="DRAWING_LIMIT");
});
test("provisional setter, reversed-pair replacement, explicit fill deletion, cascade and line GC restore committed fill state on a no-branch tick",async()=>{
 for(const version of[5,6])for(const action of['f.set_color(#0000ff80)','linefill.new(b,a,#0000ff80)','f.delete()','a.delete()','line.new(3,100,8,100,color=na)']) {
  const body=channel+'\nif barstate.isrealtime and close>105\n    '+action,sessionId='linefills122-rollback-'+version+'-'+['f.set_color(#0000ff80)','linefill.new(b,a,#0000ff80)','f.delete()','a.delete()','line.new(3,100,8,100,color=na)'].indexOf(action),req={...request(body,bars.slice(0,3),version,',max_lines_count=2'),mode:"live",id:sessionId+':0'},executor=pine.createPineLiveExecutor();
  const initial=await executor.execute({protocol:"pine-live-v1",sessionId,sequence:0,action:"start",request:req}),saved=structuredClone(initial),command=(sequence,close,confirmed=false)=>({protocol:"pine-live-v1",sessionId,sequence,action:"update",bar:candle(sequence===4?4:3,close),confirmed});
  const changed=await executor.execute(command(1,110)),held=structuredClone(changed);assert.notDeepEqual(changed.lineFills,initial.lineFills);
  const restored=await executor.execute(command(2,95));assert.deepEqual(restored.lineFills,initial.lineFills);assert.deepEqual(restored.lines,initial.lines);assert.deepEqual(initial,saved);assert.deepEqual(changed,held);
  const committed=await executor.execute(command(3,110,true)),next=await executor.execute(command(4,95));assert.deepEqual(next.lineFills,committed.lineFills);executor.dispose();
 }
});
test("helper-only fill roots and mutable boundary geometry survive provisional compaction and restart",async()=>{
 const body='var line a=line.new(2,90,8,90,color=na)\nvar line b=line.new(2,110,8,110,color=na)\nif bar_index==0\n    linefill.new(a,b,#ff000080)\nif barstate.isrealtime and close>105\n    linefill.new(a,b,#0000ff80)\n    a.set_y2(100)';
 const sessionId='linefills122-helper-roots',req={...request(body,bars.slice(0,3)),mode:"live",id:sessionId+':0'},executor=pine.createPineLiveExecutor();
 const initial=await executor.execute({protocol:"pine-live-v1",sessionId,sequence:0,action:"start",request:req}),command=(sequence,close)=>({protocol:"pine-live-v1",sessionId,sequence,action:"update",bar:candle(3,close),confirmed:false});
 const changed=await executor.execute(command(1,110));assert.equal(changed.lineFills[0].color,"#0000ff80");assert.equal(changed.lines[0].y2,100);
 const restored=await executor.execute(command(2,95));assert.deepEqual(restored.lineFills,initial.lineFills);assert.deepEqual(restored.lines,initial.lines);executor.dispose();
});

test("same-line fills are valid zero-area snapshots and extreme finite boundaries clip to a bounded viewport",async()=>{
 const same=await run('var line a=line.new(2,90,8,110,color=na)\nlinefill.new(a,a,#ff000080)');assert.equal(same.lineFills.length,1);assert.equal(same.lineFills[0].line1,same.lineFills[0].line2);const f=fixture(same);assert.equal(f.draw().fills.length,0);assert.equal(f.installed.drawingPrimitive.rangeForVisible(),null);f.installed.dispose();
 const extreme=fixture(await run('var line a=line.new(2,-1e100,8,-1e100,color=na,extend=extend.both)\nvar line b=line.new(2,1e100,8,1e100,color=na,extend=extend.both)\nlinefill.new(a,b,#ff000080)'));
 const paint=extreme.draw().fills;assert.ok(paint.some(p=>inside(p.points,70,50)));assert.ok(paint.every(p=>p.points.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=200&&y>=0&&y<=160)));extreme.installed.dispose();
});
