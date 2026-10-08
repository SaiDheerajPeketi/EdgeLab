import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, platform: "browser", format: "esm", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()], define: { "import.meta.env": "{}" }, stdin: {
  contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";export * from "./frontend/src/lib/pineChartAdapter.ts";export * from "./frontend/src/lib/pineProtocol.ts";',
  resolveDir: new URL("../../", import.meta.url).pathname, loader: "ts", sourcefile: "pine-lines121-oracles.ts",
} })).outputFiles[0].text;
console.info("PINE_LINES121_BINDING " + JSON.stringify({ minify: true, sealed: true, bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const start = 1700000040;
const candle = (index, close = 100) => ({ time: start + index * 60, open: close, high: close + 2, low: close - 2, close, volume: 20 });
const bars = Array.from({ length: 12 }, (_, i) => candle(i));
const context = { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const source = (body, version = 6, extra = "") => `//@version=${version}\nindicator("Lines 121",overlay=false${extra})\n${body}`;
const request = (body, snapshot = bars, version = 6, extra = "") => ({ id: "lines121", action: "run", source: source(body, version, extra), bars: snapshot, inputs: {}, context });
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

test("v5/v6 retain final setters and copy identity rather than repeating drawing history", async () => {
  for (const version of [5,6]) {
    const result = await run(defaultLine + '\nif bar_index==1\n    line.set_y2(a,105)\nif bar_index==2\n    a.set_color(#00ff00)\n    b=a.copy()\n    b.set_xy1(3,95)\n    b.set_xy2(9,115)\n    b.set_width(5)\nplot(line.get_y2(a),"Numeric")', bars, version);
    assert.equal(result.lines.length,2); assert.equal(new Set(result.lines.map(l=>l.id)).size,2);
    assert.deepEqual(result.lines.map(geometry), [[2,90,8,105,"bar_index","none","#00ff00","solid",2,false],[3,95,9,115,"bar_index","none","#00ff00","solid",5,false]]);
    assert.deepEqual(values(result,"Numeric"),[110,...Array(11).fill(105)]);
    assert.ok(!result.diagnostics.some(d=>d.code==="UNSUPPORTED_DRAWING"));
    const adapted=pine.adaptPineChartResult(result,bars); assert.equal(adapted.plots.filter(p=>p.kind==="drawing_line").length,1);
    assert.equal(pine.latestPineChartPoint(adapted.plots.find(p=>p.kind==="drawing_line")),null);
  }
});
test("delete and max_lines_count remove obsolete objects while replay owns only its truncated state", async () => {
  for(const version of [5,6]) {
    const body=defaultLine+'\nif bar_index==3\n    a.delete()\nif bar_index==4\n    line.new(4,80,7,120,color=#0000ff)';
    assert.equal((await run(body,bars.slice(0,3),version)).lines.length,1);
    assert.deepEqual((await run(body,bars.slice(0,4),version)).lines??[],[]);
    assert.deepEqual((await run(body,bars.slice(0,5),version)).lines.map(l=>l.color),["#0000ff"]);
    const evicted=await run('line.new(bar_index,90,bar_index+1,110,color=#ff0000)',bars,version,',max_lines_count=3');
    assert.deepEqual(evicted.lines.map(l=>[l.x1,l.x2]),[[9,10],[10,11],[11,12]]);
  }
});
test("chart point overload and setters preserve bar-index and millisecond bar-time geometry", async () => {
  for(const version of [5,6]) {
    const body='var line a=line.new(chart.point.from_index(1,90),chart.point.from_index(8,110),color=#ff0000)\nif bar_index==2\n    a.set_first_point(chart.point.from_index(3,95))\n    a.set_second_point(chart.point.from_index(9,115))\nvar line b=line.new(time+30000,100,time+90000,120,xloc=xloc.bar_time,color=#0000ff)\nif bar_index==3\n    line.set_xloc(b,time-30000,time+30000,xloc.bar_time)';
    const result=await run(body,bars,version);
    assert.deepEqual(result.lines.map(l=>[l.x1,l.y1,l.x2,l.y2,l.xloc]),[[3,95,9,115,"bar_index"],[start+150,100,start+210,120,"bar_time"]]);
  }
});
test("force overlay groups drawings by placement without injecting timeline candles", async () => {
  const result=await run(defaultLine+'\nvar line b=line.new(2,80,20,120,color=#00ff00,force_overlay=true)');
  assert.deepEqual(result.lines.map(l=>l.overlay),[false,true]);
  const adapted=pine.adaptPineChartResult(result,bars); assert.deepEqual(adapted.plots.map(p=>[p.kind,p.overlay]),[["drawing_line",false],["drawing_line",true]]);
  for(const plot of adapted.plots) { assert.deepEqual(plot.segments,[]); assert.deepEqual(plot.markers,[]); }
  const f=fixture(result); assert.equal(f.hosts.length,1); assert.ok(f.hosts.every(h=>h.data.every(p=>bars.some(b=>b.time===p.time))));
  f.installed.dispose(); f.installed.dispose(); assert.equal(f.listeners.size,0); assert.equal(f.detached.length,1); assert.equal(f.removed.length,1);
  assert.equal(f.draw().strokes.length,0);
});
test("none and left/right/both extensions follow chart-left/right directions including reversed and vertical lines", async () => {
  for(const extend of ["none","left","right","both"]) {
    const f=fixture(await run(defaultLine+'\n'+'a.set_extend(extend.'+extend+')')), stroke=f.draw().strokes[0];
    assert.equal(f.draw().strokes.length,1);
    for(const [x,y] of stroke.points) assert.ok(Math.abs(y-(150-(90+(x-40)/3)))<1e-8,"Slope remains authored through clipping");
    assert.equal(stroke.points[0][0] < 0,extend==="left"||extend==="both");
    assert.equal(stroke.points[1][0] > 200,extend==="right"||extend==="both");
    if(extend==="none")assert.deepEqual(stroke.points,[[40,60],[100,40]]);
    f.installed.dispose();
  }
  const reversed=fixture(await run('var line a=line.new(8,110,2,90,color=#ff0000,extend=extend.right)'));
  assert.ok(reversed.draw().strokes[0].points.some(p=>p[0]>200)); assert.ok(!reversed.draw().strokes[0].points.some(p=>p[0]<0)); reversed.installed.dispose();
  const vertical=fixture(await run('var line a=line.new(5,90,5,110,color=#ff0000,extend=extend.both)'));
  const vp=vertical.draw().strokes[0].points; assert.ok(vp.every(p=>p[0]===70)); assert.ok(Math.min(...vp.map(p=>p[1]))<0&&Math.max(...vp.map(p=>p[1]))>160); vertical.installed.dispose();
});
test("sparse bar-time interpolation and future bar-index whitespace use logical chart geometry", async () => {
  const sparse=bars.slice(0,4).map((b,i)=>({...b,time:start+[0,60,600,660][i]}));
  const bt=fixture(await run('var line a=line.new('+(start+330)*1000+',90,'+(start+630)*1000+',110,xloc=xloc.bar_time,color=#ff0000)',sparse),sparse);
  assert.deepEqual(bt.draw().strokes[0].points,[[35,60],[45,40]]); bt.installed.dispose();
  const future=fixture(await run('var line a=line.new(10,90,15,110,color=#ff0000)'),bars,9,18);
  assert.deepEqual(future.draw().strokes[0].points,[[30,60],[80,40]]);
  assert.ok(future.hosts[0].data.every(p=>bars.some(b=>b.time===p.time))); future.installed.dispose();
});
test("native styles widths and colors paint independent canvas paths and restore context", async () => {
  for(const style of ["solid","dashed","dotted","arrow_left","arrow_right","arrow_both"]) {
    const f=fixture(await run(defaultLine+'\na.set_style(line.style_'+style+')\na.set_width(5)'));
    const out=f.draw(); assert.ok(out.strokes.length>0); assert.ok(out.strokes.every(s=>s.color==="#ff0000"&&s.width===5));
    if(style==="dashed"||style==="dotted") assert.ok(out.strokes[0].dash.length>0); else assert.deepEqual(out.strokes[0].dash,[]);
    if(style.startsWith("arrow")) assert.ok(out.fills.length+out.strokes.length>1,"Authored arrow heads add geometry");
    assert.deepEqual(out.ctx.dash,[]); assert.equal(out.ctx.strokeStyle,"initial"); assert.equal(out.ctx.lineWidth,1); f.installed.dispose();
  }
});
test("visible clipped lines bound price autoscale while hidden na degenerate and offscreen drawings do not", async () => {
  const f=fixture(await run('var line a=line.new(0,50,10,150,color=#ff0000)'),bars,2,8);
  const range=f.installed.drawingPrimitive.rangeForVisible(); assert.ok(Math.abs(range.priceRange.minValue-70)<1e-8); assert.ok(Math.abs(range.priceRange.maxValue-130)<1e-8);
  f.pan(15,20); assert.equal(f.installed.drawingPrimitive.rangeForVisible(),null); assert.equal(f.draw().strokes.length,0); f.installed.dispose();
  for(const body of ['line.new(2,90,8,110,color=na)','line.new(2,90,8,110,color=#ff000000)','line.new(2,na,8,110,color=#ff0000)','line.new(2,90,2,90,color=#ff0000)']) {
    const empty=fixture(await run(body)); assert.equal(empty.draw().strokes.length,0); assert.equal(empty.installed.drawingPrimitive?.rangeForVisible()??null,null); empty.installed.dispose();
  }
});
test("unsupported native width and style are disclosed omissions rather than changed geometry", async () => {
  for(const body of ['line.new(2,90,8,110,color=#ff0000,width=17)','line.new(2,90,8,110,color=#ff0000,style="wrong")']) {
    const result=await run(body); assert.deepEqual(result.lines??[],[]); assert.ok(result.diagnostics.some(d=>/line|drawing/i.test(d.message)&&/width|style|unsupported/i.test(d.message)));
  }
  assert.equal((await run('line.new(2,90,8,110,color=#ff0000,width=16)')).lines[0].width,16);
});
test("legacy and packed protocol retain the final drawing snapshot and reject adversarial fields", async () => {
  const req=request(defaultLine),native=await pine.executePineRequest(req);
  const response=result=>({id:req.id,status:"completed",result});
  const round=pine.validatePineResponse(response(structuredClone(native)),req); assert.deepEqual(round.lines,native.lines);
  const before=structuredClone(round.lines); native.lines[0].y2=999; assert.deepEqual(round.lines,before,"Validation must own its copied drawing fields");
  const altered=fn=>{const result=structuredClone(round);fn(result);return result;};
  for(const change of [r=>r.lines.push({...r.lines[0]}),r=>r.lines[0].extra=true,r=>r.lines[0].id="",r=>r.lines[0].xloc="bi",r=>r.lines[0].extend="r",r=>r.lines[0].style="style_solid",r=>r.lines[0].width=17,r=>r.lines[0].width=1.5,r=>r.lines[0].x1=1.5,r=>r.lines[0].y1=Infinity,r=>r.lines[0].overlay=1,r=>r.lines[0].color="url(javascript:alert(1))",r=>delete r.lines[0].y2]) {
    assert.throws(()=>pine.validatePineResponse(response(altered(change)),req),undefined,"Malformed drawing must reject");
  }
  const tooMany=altered(r=>r.lines=Array.from({length:501},(_,i)=>({...r.lines[0],id:"line"+i}))); assert.throws(()=>pine.validatePineResponse(response(tooMany),req));
  let reads=0; const accessor=altered(r=>Object.defineProperty(r.lines[0],"y1",{enumerable:true,get(){reads++;return 90;}})); assert.throws(()=>pine.validatePineResponse(response(accessor),req)); assert.equal(reads,0);
  const inherited=altered(r=>Object.setPrototypeOf(r.lines[0],{y1:90})); assert.throws(()=>pine.validatePineResponse(response(inherited),req));
  const packedBars=Array.from({length:5000},(_,i)=>candle(i)),packed=await run(defaultLine+'\nplot(close,"Packed")',packedBars);
  assert.equal(packed.lines.length,1); assert.equal(packed.plots[0].points.length,5000); assert.deepEqual(geometry(packed.lines[0]),geometry(round.lines[0]));
});
test("persistent live worker replaces provisional newborns and retains owned prior snapshots on mutation and confirmation", async () => {
  for(const version of [5,6]) {
    const body='var line a=line.new(0,90,2,100,color=#ff0000)\na.set_y2(close)\nif barstate.isrealtime\n    line.new(bar_index,close,bar_index+1,close,color=#0000ff)';
    const req={...request(body,bars.slice(0,3),version),mode:"live",id:"lines121-live-oracle:0"},executor=pine.createPineLiveExecutor(),sessionId="lines121-live-oracle";
    const initial=await executor.execute({protocol:"pine-live-v1",sessionId,sequence:0,action:"start",request:req});
    assert.equal(initial.lines.length,1); assert.equal(initial.lines[0].y2,100); const held=structuredClone(initial);
    for(const [sequence,close,confirmed] of [[1,110,false],[2,95,false],[3,105,true]]) {
      const result=await executor.execute({protocol:"pine-live-v1",sessionId,sequence,action:"update",bar:candle(3,close),confirmed});
      assert.equal(result.lines.length,2); assert.equal(result.lines[0].id,initial.lines[0].id);
      assert.deepEqual(result.lines.map(l=>[l.x1,l.y1,l.x2,l.y2]),[[0,90,2,close],[3,close,4,close]]);
      assert.deepEqual(initial,held,"Published snapshots cannot retain mutable engine aliases");
    }
    const next=await executor.execute({protocol:"pine-live-v1",sessionId,sequence:4,action:"update",bar:candle(4,115),confirmed:false});
    assert.equal(next.lines.length,3); assert.deepEqual(next.lines.slice(1).map(l=>[l.x1,l.y1,l.x2,l.y2]),[[3,105,4,105],[4,115,5,115]]); executor.dispose();
  }
});

test("provisional mutations and deletion of an existing line restore on a later tick that performs no setter", async () => {
  for(const version of [5,6]) for(const mode of ["setters","delete"]) {
    const body='var line a=line.new(0,90,2,100,color=#ff0000,width=2)\nif barstate.isrealtime and close>105\n'+(mode==="delete"?'    a.delete()':'    a.set_xy2(7,close)\n    a.set_color(#0000ff)\n    a.set_width(5)\n    a.set_style(line.style_dashed)');
    const sessionId='lines121-rollback-'+mode+'-'+version,req={...request(body,bars.slice(0,3),version),mode:"live",id:sessionId+':0'},executor=pine.createPineLiveExecutor();
    const initial=await executor.execute({protocol:"pine-live-v1",sessionId,sequence:0,action:"start",request:req}),initialSnapshot=structuredClone(initial),original=geometry(initial.lines[0]);
    const command=(sequence,close,confirmed=false)=>({protocol:"pine-live-v1",sessionId,sequence,action:"update",bar:candle(sequence===4?4:3,close),confirmed});
    const provisional=await executor.execute(command(1,110)),held=structuredClone(provisional);
    if(mode==="delete")assert.deepEqual(provisional.lines??[],[]);else assert.deepEqual(geometry(provisional.lines[0]),[0,90,7,110,"bar_index","none","#0000ff","dashed",5,false]);
    const restored=await executor.execute(command(2,95));assert.deepEqual(restored.lines.map(geometry),[original]);assert.equal(restored.lines[0].id,initial.lines[0].id);
    assert.deepEqual(initial,initialSnapshot);assert.deepEqual(provisional,held);
    const committed=await executor.execute(command(3,110,true)),next=await executor.execute(command(4,95));
    assert.deepEqual(next.lines??[],committed.lines??[],"A confirmed mutation or deletion persists on the next bar");executor.dispose();
  }
});

test("saved custom input IDs rerun native line width and pattern while active drawing limits fail explicitly",async()=>{
  const body='width=input.int(2,"Width",minval=1,maxval=16)\npattern=input.string("Solid","Pattern",options=["Solid","Dashed"])\nline.new(2,90,8,110,color=#ff0000,width=width,style=pattern=="Dashed"?line.style_dashed:line.style_solid)';
  const req=request(body),prepared=await pine.executePineRequest({id:"lines121-prepare",action:"prepare",source:req.source});
  const inputs=Object.fromEntries(prepared.inputDefinitions.map(d=>[d.id,d.title==="Width"?7:"Dashed"]));
  const result=await pine.executePineRequest({...req,inputs});assert.deepEqual(result.inputs,inputs);assert.ok(result.lines.every(l=>l.width===7&&l.style==="dashed"));
  const snapshot=Array.from({length:501},(_,i)=>candle(i));
  const bounded=await run('line.new(bar_index,90,bar_index+1,110,color=#ff0000)',snapshot,6,',max_lines_count=500');
  assert.equal(bounded.lines.length,500);assert.equal(new Set(bounded.lines.map(l=>l.id)).size,500);
  await assert.rejects(run('line.new(bar_index,90,bar_index+1,110,color=#ff0000)',snapshot,6,',max_lines_count=501'),cause=>cause.code==="DRAWING_LIMIT");
});

test("discarded-return helper-only lines survive provisional newborn eviction rollback and retain committed replacement",async()=>{
  for(const version of [5,6]) {
    const body='if bar_index==0\n    line.new(1,100,6,100,color=#ff0000)\nif barstate.isrealtime and close>105\n    line.new(bar_index,110,bar_index+1,110,color=#0000ff)';
    const sessionId='lines121-helper-roots-'+version,req={...request(body,bars.slice(0,3),version,',max_lines_count=1'),mode:"live",id:sessionId+':0'},executor=pine.createPineLiveExecutor();
    const initial=await executor.execute({protocol:"pine-live-v1",sessionId,sequence:0,action:"start",request:req}),saved=structuredClone(initial.lines);
    const command=(sequence,close,confirmed=false)=>({protocol:"pine-live-v1",sessionId,sequence,action:"update",bar:candle(sequence===4?4:3,close),confirmed});
    const evicted=await executor.execute(command(1,110));assert.deepEqual(evicted.lines.map(l=>l.color),["#0000ff"]);assert.notEqual(evicted.lines[0].id,saved[0].id);
    const restored=await executor.execute(command(2,95));assert.deepEqual(restored.lines,saved,"Rollback re-registers a prior line with no script variable reference");
    const committed=await executor.execute(command(3,110,true)),next=await executor.execute(command(4,95));assert.deepEqual(next.lines,committed.lines);executor.dispose();
  }
});
test("source bar indexes map to their real positions within a shared interleaved chart timeline",async()=>{
  const snapshot=bars.slice(0,4),timeline=snapshot.flatMap(b=>[b,{...b,time:b.time+30}]);
  const result=await run('line.new(1,90,3,110,color=#ff0000)',snapshot),f=fixture(result,snapshot,0,7,timeline);
  assert.deepEqual(f.draw().strokes[0].points,[[40,60],[80,40]],"Source indexes 1 and 3 refer to chart logical slots 2 and 6");
  assert.ok(f.hosts.every(h=>h.data.every(p=>snapshot.some(b=>b.time===p.time))));f.installed.dispose();
});
