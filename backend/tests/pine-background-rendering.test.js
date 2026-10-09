import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const bundle = (await build({ plugins: [createPineEnginePlugin()], bundle:true,format:"esm",platform:"browser",write:false,logLevel:"silent",stdin:{
  contents:'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export * from "./frontend/src/lib/pineChartAdapter.ts"; export {PineTS,Indicator} from "pinets";',
  loader:"ts",resolveDir:fileURLToPath(new URL("../..",import.meta.url)),sourcefile:"pine-background-oracles.ts",
}})).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bytes = readFileSync(new URL("../../e2e/pine-visuals.bars.json",import.meta.url));
assert.equal(createHash("sha256").update(bytes).digest("hex"),"fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
const bars = JSON.parse(bytes), context = {symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1};
const program = body => '//@version=6\nindicator("Background proof",overlay=false)\n'+body;
const request = (source,snapshot=bars,inputs={}) => ({id:"background-oracle",action:"run",source,bars:snapshot,inputs,context});
const native = async(source,snapshot=bars,inputs={}) => {try{return await pine.executePineRequest(request(source,snapshot,inputs));}catch(cause){throw Object.assign(new Error(cause.message),{code:cause.code});}};
const normalize = options => Object.fromEntries(Object.entries(options??{}).filter(([key])=>!key.startsWith("_")).map(([key,value])=>[key,value===undefined||typeof value==="number"&&!Number.isFinite(value)?null:value]));
// Separate pinned engine execution does not use the worker, wire encoder or chart adapter.
async function raw(source,snapshot=bars,inputs={}) {
  const engine = new pine.PineTS(snapshot.map(bar=>({openTime:bar.time*1000,closeTime:(bar.time+60)*1000,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume})),"TEST","1",snapshot.length);
  engine.setTimezone("UTC"); engine.setMaxLoops(10000);
  return engine.run(new pine.Indicator(source,inputs));
}
function compareBackground(result,oracle,snapshot) {
  const outputs=result.plots.filter(plot=>plot.style==="background");
  assert.ok(outputs.length);
  for(const plot of outputs) {
    const expected=oracle.plots[plot.id]??Object.values(oracle.plots).filter(plot=>plot.options.style==="background")[outputs.indexOf(plot)]; assert.ok(expected);
    if(expected.title)assert.equal(plot.name,expected.title);else assert.ok(plot.name.length); assert.deepEqual(plot.options,{offset:0,editable:true,display:"all",force_overlay:false,...normalize(expected.options)});
    for(let index=0;index<snapshot.length;index++) {
      const point=pine.getPackedPinePlot(plot)?pine.pointAtBar(plot,index):plot.points[index], expectedPoint=expected.data[index];
      assert.deepEqual(point,{time:snapshot[index].time,value:typeof expectedPoint.value==="number"&&!Number.isFinite(expectedPoint.value)?null:expectedPoint.value??null,options:normalize(expectedPoint.options)});
    }
  }
  return outputs;
}
const at=(plot,index)=>pine.getPackedPinePlot(plot)?pine.pointAtBar(plot,index):plot.points[index];
const migrations=JSON.parse(readFileSync(new URL("../../frontend/src/lib/pineCatalogMigrations.json",import.meta.url))).entries;
for(const [stem,mainName,toggle,threshold] of [
  ["stochastic","%K","Highlight Middle Line Crossovers ?",50],
  ["mfi_money_flow_index","MFI","Highlight Middle Line Crossovers ?",50],
  ["trix","TRIX","Highlight Zero Line Crossovers ?",0],
]) test(stem+" retains original background branch and every native color under both input states",async()=>{
  const pin=migrations.find(entry=>entry.path.endsWith("/"+stem+".pine"));
  const original=readFileSync(new URL("../../frontend/public/catalog/pine/everget/"+pin.upstreamCommit+"/"+pin.path,import.meta.url));
  const source=readFileSync(new URL("../../frontend/public"+pin.sourcePath,import.meta.url),"utf8");
  assert.equal(createHash("sha256").update(original).digest("hex"),pin.originalSourceSha256);
  assert.equal(createHash("sha256").update(source).digest("hex"),pin.sourceSha256);
  assert.match(original.toString(),/bgcolor\(/); assert.match(original.toString(),/transp=90/);
  const prepared=await native(source), input=prepared.inputDefinitions.find(item=>item.title===toggle); assert.ok(input);
  for(const enabled of [true,false]) {
    const overrides={[input.id]:enabled}, result=await native(source,bars,overrides), oracle=await raw(source,bars,overrides);
    const [background]=compareBackground(result,oracle,bars), main=result.plots.find(plot=>plot.name===mainName); assert.ok(main);
    for(let index=0;index<bars.length;index++) {
      const value=at(main,index)?.value;
      const expected=enabled ? (typeof value==="number"&&value>threshold ? "#4CAF501A" : "#FF52521A") : stem==="stochastic" ? null : "#FFFFFF00";
      assert.equal(at(background,index).options.color,expected,stem+"/"+enabled+"/"+index);
    }
  }
});

test("named native background alpha na color inputs and placement retain raw per-bar output",async()=>{
  const source=program('c=input.color(#ff000080,"Tint")\nbgcolor(bar_index%3==0?na:bar_index%3==1?c:#0000ff,title="Shade",offset=0,editable=false,show_last=3,display=display.all,force_overlay=true)');
  for(const inputs of [{},{in_0:"#00ff0040"}]) {
    const result=await native(source,bars,inputs), [plot]=compareBackground(result,await raw(source,bars,inputs),bars);
    assert.equal(plot.overlay,true); assert.equal(plot.options.show_last,3); assert.equal(plot.options.editable,false);
    assert.equal(plot.options.display,"all"); assert.equal(plot.options.force_overlay,true);
    assert.equal(result.source,source);
    for(let index=0;index<bars.length;index++) {
      const point=at(plot,index), expected=index%3===0?null:index%3===1?(inputs.in_0??"#ff000080"):"#0000ff";
      assert.equal(point.options.color,expected); assert.equal(point.value,expected===null?null:true);
    }
  }
});

// The chart uses uniform logical bar slots even across a session break. This
// coordinate oracle is independent of source timestamps and renderer formulas.
function chartHarness(snapshot=bars,from=0,to=snapshot.length-1,globalBars=snapshot,width=200,height=128) {
  const indices=new Map(globalBars.map((bar,index)=>[bar.time,index])), listeners=new Set(), created=[],removed=[];
  // Pinned LWC4 rejects fractional logical indices: its public API returns0.
  // Band boundaries must be interpolated from adjacent supported integer centers.
  const logicalToCoordinate=index=>Number.isInteger(index)?20+(index-from)*12:0;
  const scale={timeToCoordinate:time=>indices.has(time)?logicalToCoordinate(indices.get(time)):null,
    coordinateToLogical:x=>from+(x-20)/12, logicalToCoordinate,
    getVisibleLogicalRange:()=>({from,to}), getVisibleRange:()=>({from:globalBars[Math.max(0,Math.floor(from))]?.time,to:globalBars[Math.min(globalBars.length-1,Math.ceil(to))]?.time}),
    subscribeVisibleTimeRangeChange:fn=>listeners.add(fn),unsubscribeVisibleTimeRangeChange:fn=>listeners.delete(fn)};
  const chart={timeScale:()=>scale,paneSize:()=>({width,height}),removeSeries:series=>removed.push(series),addLineSeries(options){
    const series={data:[],options:()=>options,setData(data){this.data=data;},priceToCoordinate:price=>height/2-price,
      attachPrimitive(primitive){primitive.attached({chart,series:this,requestUpdate(){}});},detachPrimitive(primitive){primitive.detached();}};
    created.push(series);return series;
  }};
  return {chart,created,removed,listeners,coordinate:time=>scale.timeToCoordinate(time),pan(a,b){from=a;to=b;for(const fn of listeners)fn();},resize(w,h){width=w;height=h;}};
}
function canonical(color){const value=String(color).trim();if(value.startsWith("#")){const h=value.slice(1);return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),h.length===8?parseInt(h.slice(6),16)/255:1].join(",");}const m=value.match(/^rgba?\(([^)]+)\)$/);if(m){const parts=m[1].split(",").map(Number);return [...parts.slice(0,3),parts[3]??1].join(",");}return value;}
function paint(installed,width=200,height=128) {
  const commands=[],states=[];let path=[];
  const ctx={fillStyle:"black",strokeStyle:"black",globalAlpha:1,lineWidth:1,save(){states.push({fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,globalAlpha:this.globalAlpha});},restore(){Object.assign(this,states.pop());},
    beginPath(){path=[];},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},closePath(){},rect(x,y,w,h){path.push([x,y],[x+w,y],[x+w,y+h],[x,y+h]);},clip(){},
    fillRect(x,y,w,h){commands.push({kind:"rect",color:canonical(this.fillStyle),x,y,w,h});},fill(){commands.push({kind:"fill",color:canonical(this.fillStyle),path:[...path]});},stroke(){commands.push({kind:"stroke",color:canonical(this.strokeStyle),path:[...path]});},setLineDash(){},arc(){},fillText(){},
  };
  const target={useMediaCoordinateSpace(fn){fn({context:ctx,mediaSize:{width,height},horizontalPixelRatio:1,verticalPixelRatio:1});}};
  for(const view of installed.primitive.paneViews())view.renderer()?.drawBackground?.(target);for(const view of installed.primitive.paneViews())view.renderer()?.draw(target);
  return commands;
}
// Compare covered intervals, allowing an equivalent contiguous rectangle run.
// This does not require a particular number of Canvas submissions per bar.
function coverage(rectangles){
 const result=[];
 for(const rect of rectangles.map(({x,y,w,h,color})=>({x,y,w,h,color})).sort((a,b)=>a.x-b.x)){
  const previous=result.at(-1);
  if(previous)assert.ok(rect.x>=previous.x+previous.w,"A single background channel must not double-paint alpha coverage");
  if(previous&&previous.x+previous.w===rect.x&&previous.y===rect.y&&previous.h===rect.h&&previous.color===rect.color)previous.w+=rect.w;
  else result.push({...rect});
 }
 return result;
}
function installation(result,snapshot=bars,...args) {
  const adapted=pine.adaptPineChartResult(result,snapshot),state=chartHarness(snapshot,...args);
  return {adapted,...state,installed:pine.installPineChartPlots(state.chart,adapted.plots)};
}

test("background draws full-height logical half-slot bands through session gaps and sparse chart timelines",async()=>{
  const snapshot=bars.slice(0,4).map((bar,index)=>({...bar,time:bars[0].time+[0,60,172800,172860][index]}));
  const global=[snapshot[0],{...snapshot[0],time:snapshot[0].time+30},snapshot[1],snapshot[2],{...snapshot[2],time:snapshot[2].time+30},snapshot[3]];
  const result=await native(program('bgcolor(#ff000080,title="Sessions")'),snapshot);
  const f=installation(result,snapshot,0,5,global);
  assert.equal(f.adapted.plots[0].kind,"background");
  assert.equal(f.installed.primitive.rangeForVisible(),null); assert.equal(pine.latestPineChartPoint(f.adapted.plots[0]),null);
  const commands=paint(f.installed).filter(command=>command.kind==="rect");
  assert.deepEqual(coverage(commands),coverage([0,2,3,5].map(index=>({x:14+index*12,y:0,w:12,h:128,color:canonical("#ff000080")}))));
  assert.equal(f.installed.primitive.paneViews()[0].zOrder(),"normal"); f.installed.dispose();assert.equal(f.listeners.size,0);
});

test("background na transparent hidden false show_last and unsupported offsets never paint fallback bands",async()=>{
  const result=await native(program('bgcolor(bar_index%3==0?na:bar_index%3==1?#ff000080:#0000ff00,title="Recent",show_last=3)\nbgcolor(#00ff00,title="Hidden",display=display.none)\nbgcolor(#00ff00,title="Offset",offset=0)'));
  const bad=result.plots.find(plot=>plot.name==="Offset");bad.options.offset=1.5;bad.points=bad.points.map(point=>({...point,options:{...point.options,offset:1.5}}));
  const f=installation(result,bars,250,255);
  assert.deepEqual(f.adapted.plots.map(plot=>plot.name),["Recent"]);
  assert.ok(f.adapted.adapterWarnings.some(message=>/Offset:.*offset/i.test(message)));
  const rects=paint(f.installed).filter(command=>command.kind==="rect");
  assert.deepEqual(rects.map(rect=>rect.color),[canonical("#ff000080")]); assert.equal(rects[0].x,14+3*12);
  assert.equal(f.installed.primitive.rangeForVisible(),null); f.installed.dispose();
  const empty=await native(program('bgcolor(#ff0000,title="Invalid activity")'));
  empty.plots[0].points=empty.plots[0].points.map(point=>({...point,value:false}));
  const inactive=installation(empty);assert.equal(paint(inactive.installed).length,0);assert.equal(inactive.installed.primitive.rangeForVisible(),null);inactive.installed.dispose();
});

test("background internal layer paints before fills and cannot expand visible numeric autoscale",async()=>{
  const result=await native(program('a=plot(10,"Lower",display=display.none)\nb=plot(90,"Upper",display=display.none)\nfill(a,b,color=#00ff0080,title="Fill")\nhline(50,"Visible",color=#0000ff)\nbgcolor(#ff000080,title="Background")'));
  const f=installation(result,bars,120,125);
  const commands=paint(f.installed), red=commands.findIndex(command=>command.color===canonical("#ff000080")),green=commands.findIndex(command=>command.color===canonical("#00ff0080")),blue=commands.findIndex(command=>command.color===canonical("#0000ff"));
  assert.ok(red>=0&&green>red&&blue>green,"background must precede fill polygons and visible levels");
  assert.deepEqual(f.installed.primitive.rangeForVisible().priceRange,{minValue:50,maxValue:50});
  assert.equal(pine.latestPineChartPoint(f.adapted.plots.find(plot=>plot.kind==="background")),null);f.installed.dispose();
});

test("20k actual backgrounds keep exact packed bytes and bounded visible decoding across pan resize dispose",async()=>{
  const snapshot=Array.from({length:20000},(_,index)=>({...bars[0],time:bars[0].time+index*60}));
  const source=program('bgcolor(bar_index%3==0?na:bar_index%3==1?#ff000080:#0000ff,title="Packed background")');
  const result=await native(source,snapshot), [plot]=compareBackground(result,await raw(source,snapshot),snapshot);
  const backing=pine.getPackedPinePlot(plot);assert.ok(backing);assert.equal(Array.isArray(plot.points),false);
  assert.equal(backing.values.length,20000);assert.equal(backing.kinds.length,20000);
  const f=installation(result,snapshot,10000,10020);
  assert.equal(f.installed.primitive.rangeForVisible(),null);paint(f.installed);
  const first=f.installed.primitive.debugStats;assert.ok(first.decodedSamples<=25,JSON.stringify(first));
  f.pan(15000,15020);const commands=paint(f.installed);const second=f.installed.primitive.debugStats;
  assert.ok(second.decodedSamples-first.decodedSamples<=25);assert.ok(second.cacheEntries<=25);const expectedBands=Array.from({length:23},(_,i)=>14999+i).filter(i=>i%3!==0 && 14+(i-15000)*12<200 && 26+(i-15000)*12>0);
  assert.equal(commands.length,expectedBands.length);
  f.resize(360,200);assert.ok(paint(f.installed,360,200).every(command=>command.h===200));
  const wire=pine.toPineWireResponse("background-oracle",result,snapshot);assert.equal(wire.buffers.length,3);
  assert.equal(wire.buffers.reduce((n,buffer)=>n+buffer.byteLength,0),220000);
  const transferred=structuredClone(wire,{transfer:wire.buffers});assert.ok(wire.buffers.every(buffer=>buffer.byteLength===0));
  const decoded=pine.validatePineResponse(transferred,pine.validatePineRequest(request(source,snapshot)));
  assert.ok(transferred.buffers.includes(pine.getPackedPinePlot(decoded.plots[0]).values.buffer));
  f.installed.dispose();f.installed.dispose();assert.equal(f.installed.primitive.debugStats.cacheEntries,0);assert.equal(f.listeners.size,0);assert.equal(f.removed.length,1);
});


test("constant integer offsets shift chart slots after source show_last including future whitespace",async()=>{
  const snapshot=bars.slice(0,4),global=[snapshot[0],{...snapshot[0],time:snapshot[0].time+30},snapshot[1],snapshot[2],{...snapshot[2],time:snapshot[2].time+30},snapshot[3]];
  for(const offset of [2,-2]) {
    const result=await native(program('bgcolor(#ff000080,title="Shifted",show_last=2,offset='+offset+')'),snapshot);
    const f=installation(result,snapshot,0,8,global);
    assert.equal(f.adapted.plots[0].visual.backgroundOffset,offset);
    assert.equal(f.adapted.adapterWarnings.length,0);
    const expected=[3,5].map(index=>({x:14+(index+offset)*12,y:0,w:12,h:128,color:canonical("#ff000080")}));
    assert.deepEqual(paint(f.installed).filter(c=>c.kind==="rect").map(({x,y,w,h,color})=>({x,y,w,h,color})),expected);
    assert.equal(f.installed.primitive.rangeForVisible(),null);f.installed.dispose();
  }
  const future=await native(program('bgcolor(bar_index==3?#ff0000:na,title="Future",show_last=1,offset=5)'),snapshot);
  const f=installation(future,snapshot,8,10,global);
  assert.deepEqual(paint(f.installed).filter(c=>c.kind==="rect").map(({x,y,w,h,color})=>({x,y,w,h,color})),[{x:38,y:0,w:12,h:128,color:canonical("#ff0000")}]);
  assert.equal(f.installed.primitive.rangeForVisible(),null);f.installed.dispose();
});

test("seven positional and mixed background flags match equivalent raw named calls without overlay demotion",async()=>{
  for(const overlay of [false,true])for(const force of [false,true]) {
    const declaration='//@version=6\nindicator("Flags",overlay='+overlay+')\n';
    const calls=['bgcolor(#ff000080,2,false,3,"Positional",display.all,'+force+')','bgcolor(#ff000080,2,editable=false,show_last=3,title="Positional",display=display.all,force_overlay='+force+')'];
    const named=declaration+'bgcolor(color=#ff000080,offset=2,editable=false,show_last=3,title="Positional",display=display.all,force_overlay='+force+')';
    const oracle=await raw(named), expected=Object.values(oracle.plots).find(plot=>plot.options.style==="background");
    for(const body of calls){
      const result=await native(declaration+body),plot=result.plots[0];
      assert.equal(plot.name,"Positional");assert.equal(plot.overlay,overlay||force);
      assert.deepEqual(plot.options,{...normalize(expected.options),overlay:overlay||force});
      for(let i=0;i<bars.length;i++)assert.deepEqual(at(plot,i),{time:bars[i].time,value:true,options:{color:"#ff000080"}});
    }
  }
});

test("untitled duplicated and numeric titles keep distinct source-order channels and all bar samples",async()=>{
  const source=program('plot(close,"edgelab-background:0")\nbgcolor(#ff0000)\nbgcolor(#0000ff)\nbgcolor(#00ff00,title="Same")\nbgcolor(#ffff00,title="Same")\nbgcolor(#ff00ff,title="2")\nbgcolor(#00ffff,title="1")');
  const result=await native(source),backgrounds=result.plots.filter(plot=>plot.style==="background");
  assert.equal(backgrounds.length,6);assert.equal(new Set(result.plots.map(plot=>plot.id)).size,7);
  assert.deepEqual(backgrounds.slice(2).map(plot=>plot.name),["Same","Same","2","1"]);
  for(const [index,plot]of backgrounds.entries()){
    assert.equal(plot.points.length,bars.length);
    for(let i=0;i<bars.length;i++)assert.deepEqual(at(plot,i),{time:bars[i].time,value:true,options:{color:["#ff0000","#0000ff","#00ff00","#ffff00","#ff00ff","#00ffff"][index]}});
  }
  const fresh=await native(program('bgcolor(#ff0000,title="Fresh")'));
  assert.equal(fresh.plots.length,1);assert.equal(fresh.plots[0].name,"Fresh");assert.equal(fresh.plots[0].options.offset,0);
});

test("invalid and varying background flags or changing call counts reject explicitly and leave raw engine untouched",async()=>{
  const rawSource=program('bgcolor(#ff0000,2,false,3,"Positional",display.none,true)');
  const before=await raw(rawSource);
  const invalid=[
    'bgcolor(1)','bgcolor(#ff0000,0,true,3,"T",display.all,false,0)',
    'bgcolor(#ff0000,offset=1.5)','bgcolor(#ff0000,offset=9007199254740992)',
    'bgcolor(#ff0000,editable=1)','bgcolor(#ff0000,show_last=-1)','bgcolor(#ff0000,title=1)',
    'bgcolor(#ff0000,display=display.pane)','bgcolor(#ff0000,force_overlay=1)','bgcolor(#ff0000,unknown=1)',
    'bgcolor(#ff0000,offset=bar_index%2)','bgcolor(#ff0000,editable=bar_index%2==0)',
    'bgcolor(#ff0000,show_last=bar_index)','bgcolor(#ff0000,title=str.tostring(bar_index))',
    'bgcolor(#ff0000,display=bar_index%2==0?display.all:display.none)','bgcolor(#ff0000,force_overlay=bar_index%2==0)',
    'if bar_index>0\n    bgcolor(#ff0000)','if bar_index!=128\n    bgcolor(#ff0000)','if bar_index<255\n    bgcolor(#ff0000)',
  ];
  for(const body of invalid)await assert.rejects(native(program(body)),error=>error.code==="UNSUPPORTED_BACKGROUND_OPTION",body);
  const after=await raw(rawSource);
  const project=context=>Object.values(context.plots).map(plot=>({title:plot.title,options:normalize(plot.options),points:plot.data.map(point=>({value:point.value,options:normalize(point.options)}))}));
  assert.deepEqual(project(after),project(before),"No shared engine helper or raw-context behavior may be mutated");
  assert.equal(Object.values(after.plots)[0].options.offset,undefined,"Direct raw positional loss remains outside the scoped worker context");
});

test("background channel capacity rejects the65th call without weakening existing64 boundary",async()=>{
  const source=count=>program(Array.from({length:count},(_,i)=>'bgcolor(#ff000080,title="Channel'+i+'")').join("\n"));
  const result=await native(source(64));assert.equal(result.plots.length,64);
  await assert.rejects(native(source(65)),error=>error.code==="PLOT_LIMIT");
});

test("accepted padded colors paint their parsed alpha while unsupported samples warn and leave gaps",async()=>{
  const source=program('bgcolor(bar_index%3==0?" #ff000080 ":bar_index%3==1?"not-a-color":#0000ff,title="Parsed shade")');
  const result=await native(source),plot=result.plots[0];
  assert.equal(at(plot,0).options.color," #ff000080 ");
  assert.equal(at(plot,1).options.color,"not-a-color");
  const f=installation(result,bars,0,3),commands=paint(f.installed);
  assert.ok(f.adapted.adapterWarnings.some(warning=>/color/i.test(warning)));
  assert.deepEqual(commands.map(command=>command.color),[canonical("#ff000080"),canonical("#0000ff"),canonical("#ff000080")]);
  f.installed.dispose();
});

test("duplicate background titles cannot overwrite a derived-name ordinary plot collision",async()=>{
 const source=program('bgcolor(#ff0000,title="Same")\nplot(close,"Sameedgelab-background:1")\nbgcolor(#0000ff,title="Same")');
 const result=await native(source),backgrounds=result.plots.filter(plot=>plot.style==="background");
 assert.equal(result.plots.length,3);assert.equal(new Set(result.plots.map(plot=>plot.id)).size,3);
 assert.deepEqual(backgrounds.map(plot=>plot.name),["Same","Same"]);
 for(let index=0;index<bars.length;index++){
  assert.deepEqual(at(backgrounds[0],index),{time:bars[index].time,value:true,options:{color:"#ff0000"}});
  assert.deepEqual(at(backgrounds[1],index),{time:bars[index].time,value:true,options:{color:"#0000ff"}});
  assert.equal(at(result.plots.find(plot=>plot.style!=="background"),index).value,bars[index].close);
 }
});
