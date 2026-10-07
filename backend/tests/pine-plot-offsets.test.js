import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const bundle = buildSync({bundle:true,format:"esm",platform:"browser",write:false,logLevel:"silent",stdin:{
  contents:'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pinePacked.ts";',
  loader:"ts",resolveDir:fileURLToPath(new URL("../..",import.meta.url)),sourcefile:"offset-proof.ts",
}}).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = Array.from({length:8},(_,i)=>({time:1700000040+i*60,open:i+1,high:i+2,low:i,close:i+1,volume:10}));
const source = body => '//@version=6\nindicator("Offset proof",overlay=false)\n'+body;
async function run(body,snapshot=bars,inputs={}) {
  try { return await pine.executePineRequest({id:"offset-proof",action:"run",source:source(body),bars:snapshot,inputs,context:{symbol:"TEST",timeframe:"1"}}); }
  catch(error) { throw Object.assign(new Error(error.message),{code:error.code}); }
}
// Actual-chart positions are independent of snapshot indexes and timestamp distances.
function harness(result,snapshot=bars,timeline=snapshot,from=0,to=7) {
  const indexes=new Map(timeline.map((bar,i)=>[bar.time,i])), listeners=new Set(),draws=[];
  const coordinate=i=>Number.isInteger(i)?20+(i-from)*12:0;
  const scale={timeToCoordinate:t=>indexes.has(t)?coordinate(indexes.get(t)):null,coordinateToLogical:x=>from+(x-20)/12,logicalToCoordinate:coordinate,
    getVisibleLogicalRange:()=>({from,to}),getVisibleRange:()=>({from:timeline[Math.max(0,Math.floor(from))]?.time,to:timeline[Math.min(timeline.length-1,Math.ceil(to))]?.time}),
    subscribeVisibleTimeRangeChange:f=>listeners.add(f),unsubscribeVisibleTimeRangeChange:f=>listeners.delete(f)};
  let removed=0;
  const chart={timeScale:()=>scale,paneSize:()=>({width:200,height:128}),removeSeries(){removed++;},addLineSeries(){return {
    setData(){},priceToCoordinate:p=>64-p,attachPrimitive(p){p.attached({chart,series:this,requestUpdate(){}});},detachPrimitive:p=>p.detached(),
  };}};
  const adapted=pine.adaptPineChartResult(result,snapshot),installed=pine.installPineChartPlots(chart,adapted.plots);
  const ctx={save(){},restore(){},beginPath(){this.path=[];},rect(){},clip(){},moveTo(x,y){this.path.push([x,y]);},lineTo(x,y){this.path.push([x,y]);},
    stroke(){draws.push({path:[...this.path],color:this.strokeStyle});},arc(x,y,r){draws.push({point:[x,y],radius:r,color:this.fillStyle});},fill(){},setLineDash(){}};
  return {adapted,installed,listeners,get removed(){return removed;},draw(){draws.length=0;for(const view of installed.primitive.paneViews())view.renderer()?.draw({useMediaCoordinateSpace:f=>f({context:ctx,mediaSize:{width:200,height:128}})});return [...draws];},
    pan(a,b){from=a;to=b;for(const f of listeners)f();}};
}

test("all supported numeric line styles move source geometry through actual logical slots",async()=>{
  const snapshot=bars.slice(0,4),timeline=snapshot.flatMap(bar=>[bar,{...bar,time:bar.time+30}]);
  for(const style of ["line","linebr","stepline","steplinebr","circles"])for(const offset of [-2,2]) {
    const result=await run('plot(close,"Shift",color=bar_index%2==0?#ff0000:#0000ff,style=plot.style_'+style+',offset='+offset+')',snapshot);
    const f=harness(result,snapshot,timeline,-3,9),plot=f.adapted.plots[0];
    assert.equal(plot.visual.plotOffset,offset);assert.deepEqual(f.adapted.adapterWarnings,[]);
    const commands=f.draw();assert.ok(commands.length);
    if(style==="circles")assert.deepEqual(commands.map(c=>c.point),snapshot.map((bar,i)=>[20+(i*2+offset+3)*12,64-bar.close]));
    else {assert.deepEqual(commands[0].path[0],[20+(offset+3)*12,63]);assert.deepEqual(commands.at(-1).path.at(-1),[20+(6+offset+3)*12,60]);}
    assert.deepEqual(pine.latestPineChartPoint(plot),{time:snapshot.at(-1).time,value:4});
    assert.equal(result.source,source('plot(close,"Shift",color=bar_index%2==0?#ff0000:#0000ff,style=plot.style_'+style+',offset='+offset+')'));
    f.installed.dispose();
  }
});

test("source show_last filters before shifting into future or past whitespace",async()=>{
  for(const [offset,from,to,body,value]of [[5,11,14,'close',8],[-5,-7,-3,'bar_index==0?close:na',1]]) {
    const result=await run('plot('+body+',"Edge",style=plot.style_circles,offset='+offset+',show_last='+(offset>0?1:8)+')');
    const f=harness(result,bars,bars,from,to),points=f.draw();
    assert.equal(points.length,1);assert.deepEqual(points[0].point,[20+((offset>0?7:0)+offset-from)*12,64-value]);
    assert.deepEqual(f.installed.primitive.rangeForVisible().priceRange,{minValue:value,maxValue:value});f.installed.dispose();
  }
});

test("shifted visible scale excludes offscreen prices and interpolates clipped sparse bridges",async()=>{
  const snapshot=[bars[0],{...bars[1],time:bars[0].time+600}],timeline=Array.from({length:11},(_,i)=>({...bars[0],time:bars[0].time+i*60}));
  const result=await run('plot(bar_index*100,"Bridge",offset=2)',snapshot),f=harness(result,snapshot,timeline,5,7);
  assert.deepEqual(f.installed.primitive.rangeForVisible().priceRange,{minValue:30,maxValue:50});assert.equal(f.draw().length,1);
  f.pan(6,8);assert.deepEqual(f.installed.primitive.rangeForVisible().priceRange,{minValue:40,maxValue:60});
  f.pan(13,15);assert.equal(f.installed.primitive.rangeForVisible(),null);f.installed.dispose();
  const step=harness(await run('plot(bar_index*100,"Step",style=plot.style_stepline,offset=2)',snapshot),snapshot,timeline,5,7);
  assert.deepEqual(step.installed.primitive.rangeForVisible().priceRange,{minValue:0,maxValue:0});step.installed.dispose();
});

test("broken shifted lines never bridge na and circles never synthesize edge prices",async()=>{
  for(const style of ["linebr","steplinebr","circles"]) {
    const result=await run('plot(bar_index==0?0:bar_index==7?100:na,"Gap",style=plot.style_'+style+',offset=2)');
    const f=harness(result,bars,bars,4,6);assert.equal(f.installed.primitive.rangeForVisible(),null);
    assert.equal(f.draw().filter(c=>c.path).length,0);f.installed.dispose();
  }
});

test("finite extreme endpoints keep clipped shifted autoscale finite",async()=>{
  const snapshot=[bars[0],{...bars[1],time:bars[0].time+600}],timeline=Array.from({length:11},(_,i)=>({...bars[0],time:bars[0].time+i*60}));
  const f=harness(await run('plot(bar_index==0?-1e308:1e308,"Extreme",offset=2)',snapshot),snapshot,timeline,5,7);
  const range=f.installed.primitive.rangeForVisible().priceRange;
  assert.ok(Number.isFinite(range.minValue)&&Number.isFinite(range.maxValue));
  assert.ok(Math.abs(range.minValue/1e308+.4)<1e-14);assert.equal(range.maxValue,0);f.installed.dispose();
});

test("invalid and changing offsets remain explicit omissions, including na",async()=>{
  for(const offset of ["1.5","na","bar_index%2"]) {
    await assert.rejects(run('plot(close,"Invalid",offset='+offset+')'),error=>error.code==="UNSUPPORTED_PLOT_OPTION");
    const result=await run('plot(close,"Invalid")');
    result.plots[0].options.offset=offset==="na"?null:offset==="1.5"?1.5:0;
    result.plots[0].points=result.plots[0].points.map((point,index)=>({...point,options:{...point.options,offset:offset==="bar_index%2"?index%2:result.plots[0].options.offset}}));
    const adapted=pine.adaptPineChartResult(result,bars);
    assert.equal(adapted.plots.length,0);assert.ok(adapted.adapterWarnings.some(w=>/offset/i.test(w)),offset);
  }
  for(const style of ["area","areabr","histogram","columns"]) {
    const adapted=pine.adaptPineChartResult(await run('plot(close,"Numeric",style=plot.style_'+style+',offset=2)'),bars);
    assert.equal(adapted.plots.length,1);assert.equal(adapted.plots[0].visual.plotOffset,2);
    assert.ok(!adapted.adapterWarnings.some(warning=>/Offsets for this plot style/.test(warning)));
  }
});

test("20k packed offsets keep source bytes lazy through pan and disposal",async()=>{
  const snapshot=Array.from({length:20000},(_,i)=>({...bars[0],time:bars[0].time+i*60}));
  const result=await run('plot(bar_index,"Packed",offset=5)',snapshot),packed=pine.getPackedPinePlot(result.plots[0]);assert.ok(packed);
  assert.equal(Array.isArray(result.plots[0].points),false);assert.equal(packed.values[19999],19999);
  const f=harness(result,snapshot,snapshot,10000,10020);assert.deepEqual(f.installed.primitive.rangeForVisible().priceRange,{minValue:9995,maxValue:10015});f.draw();
  const first=f.installed.primitive.debugStats;assert.ok(first.decodedSamples<30,JSON.stringify(first));
  f.pan(15000,15020);f.draw();const second=f.installed.primitive.debugStats;assert.ok(second.decodedSamples-first.decodedSamples<30);
  assert.equal(packed.values[19999],19999);assert.equal(f.adapted.plots[0].segments.length,0);
  f.installed.dispose();f.installed.dispose();assert.equal(f.listeners.size,0);assert.equal(f.removed,1);assert.equal(f.installed.primitive.debugStats.cacheEntries,0);
});
