import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";
const bundle = (await build({ plugins: [createPineEnginePlugin()], bundle:true,format:"esm",platform:"browser",write:false,logLevel:"silent",stdin:{
  contents:'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export {Indicator,PineTS} from "pinets";',
  loader:"ts",resolveDir:fileURLToPath(new URL("../..",import.meta.url)),sourcefile:"pine-numeric-oracles.ts",
}})).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = Array.from({length:8},(_,index)=>({time:1700000040+index*60,open:80,high:110,low:70,close:90+index,volume:100}));
const context = {symbol:"TEST",timeframe:"1",mintick:.01,pointvalue:1};
const source = body => '//@version=6\nindicator("Numeric plots",overlay=false)\n'+body;
const native = (body,snapshot=bars,inputs={}) => pine.executePineRequest({id:"numeric",action:"run",source:source(body),bars:snapshot,inputs,context});
async function raw(body,snapshot=bars,inputs={}) {
  const engine = new pine.PineTS(snapshot.map(bar=>({openTime:bar.time*1000,closeTime:(bar.time+60)*1000,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume})),"TEST","1",snapshot.length);
  engine.setTimezone("UTC"); return engine.run(new pine.Indicator(source(body),inputs));
}
function fixture(snapshot=bars,{from=0,width=160,height=128,spacing=20,dpr=1,global=snapshot}={}) {
  const lookup=new Map(global.map((bar,index)=>[bar.time,index])),listeners=new Set(),series=[],removed=[];
  const coordinate=index=>(index-from)*spacing;
  const scale={timeToCoordinate:time=>lookup.has(time)?coordinate(lookup.get(time)):null,coordinateToLogical:x=>Math.ceil(from+x/spacing),logicalToCoordinate:index=>Number.isInteger(index)?coordinate(index):0,
    getVisibleLogicalRange:()=>({from,to:from+width/spacing}),getVisibleRange:()=>({from:global[Math.max(0,Math.ceil(from))]?.time,to:global[Math.min(global.length-1,Math.floor(from+width/spacing))]?.time}),subscribeVisibleTimeRangeChange:fn=>listeners.add(fn),unsubscribeVisibleTimeRangeChange:fn=>listeners.delete(fn)};
  const chart={timeScale:()=>scale,paneSize:()=>({width,height}),addLineSeries(options){const item={options:()=>options,setData(data){this.data=data;},priceToCoordinate:value=>height-value,attachPrimitive(primitive){primitive.attached({chart,series:this,requestUpdate(){}});},detachPrimitive(primitive){primitive.detached();}};series.push(item);return item;},removeSeries:item=>removed.push(item)};
  const commands=[];let path=[],states=[];
  const ctx={fillStyle:"",strokeStyle:"",lineWidth:1,lineCap:"butt",dash:[],getTransform:()=>({a:dpr}),save(){states.push({fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,lineCap:this.lineCap,dash:this.dash});},restore(){Object.assign(this,states.pop());},beginPath(){path=[];},rect(x,y,w,h){path.push({rect:[x,y,w,h]});},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},arc(x,y,r){path.push({circle:[x,y,r]});},closePath(){},clip(){},setLineDash(value){this.dash=[...value];},fill(){commands.push({kind:"fill",color:this.fillStyle,path:[...path]});},stroke(){commands.push({kind:"stroke",color:this.strokeStyle,width:this.lineWidth,cap:this.lineCap,dash:this.dash,path:[...path]});},createLinearGradient(){assert.fail("Numeric area fills must be flat, not gradients");}};
  const target={useMediaCoordinateSpace:fn=>fn({context:ctx,mediaSize:{width,height}})};
  return {chart,series,removed,listeners,commands,draw(installed){commands.length=0;for(const view of installed.primitive.paneViews())view.renderer()?.drawBackground?.(target);for(const view of installed.primitive.paneViews())view.renderer()?.draw(target);return commands;},pan(next){from=next;for(const fn of listeners)fn();},zoom(next){spacing=next;for(const fn of listeners)fn();},resize(w,h){width=w;height=h;},coordinate};
}
function install(result,snapshot=bars,options={}) {const adapted=pine.adaptPineChartResult(result,snapshot),f=fixture(snapshot,options),installed=pine.installPineChartPlots(f.chart,adapted.plots);return {adapted,f,installed};}
function range(installed) {return installed.primitive.rangeForVisible()?.priceRange??null;}
function hit(command,x,y) {
  if(command.path.some(point=>!Array.isArray(point)))return command.path.some(({rect})=>rect&&x>=rect[0]&&x<=rect[0]+rect[2]&&y>=rect[1]&&y<=rect[1]+rect[3]);
  let inside=false;const points=command.path;
  for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}
  return inside;
}
function setValues(plot,values){plot.points=values.map((value,index)=>({time:bars[index].time,value,options:{color:"#ff000080"}}));}

test("actual numeric styles and input offsets preserve raw values while sharing one lazy host",async()=>{
  const body='shift=input.int(2,"Shift")\n'+["area","areabr","histogram","columns"].map(style=>`plot(close,"${style}",#ff000080,12,plot.style_${style},false,80,shift)`).join("\n");
  for(const inputs of [{},{in_0:-2}]) {
    const result=await native(body,bars,inputs),oracle=await raw(body,bars,inputs),{adapted,f,installed}=install(result);
    assert.equal(result.source,source(body)); assert.equal(adapted.plots.length,4);assert.equal(f.series.length,1);
    for(const plot of result.plots){const expected=oracle.plots[plot.id];assert.deepEqual(plot.points.map(point=>point.value),expected.data.map(point=>point.value));assert.ok(plot.points.every(point=>point.options.offset===(inputs.in_0??2)));}
    assert.ok(adapted.plots.every(plot=>plot.visual&&plot.visual.source===result.plots.find(item=>item.id===plot.id)));
    assert.equal(adapted.plots.find(plot=>plot.visual.style==="histogram").visual.histogramWidth,12);
    installed.dispose();installed.dispose();assert.equal(f.removed.length,1);assert.equal(f.listeners.size,0);
  }
});

test("area bridges na with one flat alpha run; areabr leaves every null interval unpainted",async()=>{
  for(const style of ["area","areabr"]) {
    const result=await native(`plot(close,"P",#ff000080,1,plot.style_${style})`);setValues(result.plots[0],[60,80,null,null,100,110,null,null]);
    const {f,installed}=install(result);const fills=f.draw(installed).filter(command=>command.kind==="fill");
    assert.equal(fills.some(command=>hit(command,50,110)),style==="area");
    assert.equal(fills.filter(command=>hit(command,10,110)).length,1,"Internal same-color boundary has only one fill contribution");
    assert.ok(fills.every(command=>command.color==="#ff000080"));
    if(style==="area")assert.equal(fills.length,1,"A continuous same-color alpha area has no per-interval seams");
  }
});

test("area and bar styles include baseline correctly while areabr is values-only and empty area adds none",async()=>{
  for(const [style,expected] of [["area",{minValue:0,maxValue:97}],["areabr",{minValue:90,maxValue:97}],["histogram",{minValue:0,maxValue:97}],["columns",{minValue:0,maxValue:97}]]) {
    const result=await native(`plot(close,"P",#ff000080,1,plot.style_${style})`),{installed}=install(result);assert.deepEqual(range(installed),expected,style);
    setValues(result.plots[0],Array(8).fill(null));const empty=install(result);assert.deepEqual(range(empty.installed),style==="histogram"||style==="columns"?{minValue:0,maxValue:0}:null,style+" documented empty policy");
  }
});

test("sparse shifted bridge scale clips endpoints instead of importing offscreen extreme prices",async()=>{
  const result=await native('plot(close,"P",#ff000080,1,plot.style_area,false,0,1)');setValues(result.plots[0],[0,null,null,null,100,null,null,null]);
  const {installed,f}=install(result,bars,{from:2,width:40});assert.deepEqual(range(installed),{minValue:0,maxValue:75});assert.ok(f.draw(installed).some(command=>command.kind==="fill"&&hit(command,20,100)));
  result.plots[0].style="style_areabr";result.plots[0].options.style="style_areabr";const broken=install(result,bars,{from:2,width:40});assert.equal(range(broken.installed),null);assert.equal(broken.f.draw(broken.installed).filter(command=>command.kind==="fill").length,0);
});

test("histogram12 is fixed pixels at both DPRs while columns ignore linewidth and widen on zoom",async()=>{
  for(const dpr of [1,2]) {
    const result=await native('plot(close,"P",#ff000080,12,plot.style_histogram)'),{f,installed}=install(result,bars,{dpr});
    const widths=f.draw(installed).filter(command=>command.kind==="fill").flatMap(command=>command.path.filter(point=>point.rect).map(point=>point.rect[2])).filter(width=>width>6);
    assert.ok(widths.every(width=>width===12));f.zoom(30);assert.ok(f.draw(installed).filter(command=>command.kind==="fill").flatMap(command=>command.path.filter(point=>point.rect).map(point=>point.rect[2])).filter(width=>width>6).every(width=>width===12));
    const columns=[];
    for(const linewidth of [1,12]) {const r=await native(`plot(close,"P",#ff000080,${linewidth},plot.style_columns)`),c=install(r,bars,{dpr});columns.push(c.f.draw(c.installed));assert.ok(!c.adapted.adapterWarnings.some(warning=>/line width is limited/.test(warning)));}
    assert.deepEqual(columns[0],columns[1]);
    const col=install(await native('plot(close,"P",#ff000080,12,plot.style_columns)'),bars,{dpr});const before=col.f.draw(col.installed).find(command=>command.kind==="fill").path[1].rect[2];col.f.zoom(30);const after=col.f.draw(col.installed).find(command=>command.kind==="fill").path[1].rect[2];assert.ok(after>before);assert.equal(before,19);
  }
  const bare=install(await native('plot(close,style=plot.style_histogram)'));assert.equal(bare.adapted.plots[0].visual.histogramWidth,1);
});

test("columns use chart integer neighbors across sparse sessions; show_last cuts source bars before shifting",async()=>{
  const global=Array.from({length:24},(_,index)=>({...bars[0],time:bars[0].time+index*60})),snapshot=[global[0],global[10],global[20]];
  const result=await native('plot(close,"P",#ff000080,12,plot.style_columns,false,0,2,false,true,1)',snapshot),{f,installed}=install(result,snapshot,{global,from:18,width:160});
  const rectangles=f.draw(installed).filter(command=>command.kind==="fill").flatMap(command=>command.path.filter(point=>point.rect).map(point=>point.rect));assert.equal(rectangles.length,1);assert.equal(rectangles[0][2],19);assert.equal(rectangles[0][0],71);
});

test("fixed histogram bodies partially intersecting a viewport still contribute their finite value",async()=>{
  const result=await native('plot(close,"P",#ff000080,12,plot.style_histogram)');setValues(result.plots[0],[100,null,null,null,null,null,null,null]);
  const {installed,f}=install(result,bars,{from:.2,width:64});assert.deepEqual(range(installed),{minValue:0,maxValue:100});assert.ok(f.draw(installed).some(command=>command.kind==="fill"&&hit(command,1,50)));
});

test("baseline and histogram-width scalar/constant guards qualify unsafe adapter output",async()=>{
  for(const [style,key,value] of [["area","histbase",null],["areabr","histbase",Infinity],["histogram","linewidth",1.5],["histogram","linewidth",0]]) {
    const result=await native(`plot(close,"P",#ff000080,2,plot.style_${style})`);result.plots[0].options[key]=value;const adapted=pine.adaptPineChartResult(result,bars);assert.equal(adapted.plots.length,0);assert.ok(adapted.adapterWarnings.some(warning=>/constant/.test(warning)));
  }
  for(const [style,key] of [["area","histbase"],["histogram","linewidth"]]) {const result=await native(`plot(close,"P",#ff000080,2,plot.style_${style})`);result.plots[0].points[3].options[key]=7;const adapted=pine.adaptPineChartResult(result,bars);assert.equal(adapted.plots.length,0);assert.ok(adapted.adapterWarnings.some(warning=>/changing/.test(warning)));}
});

test("extreme area interpolation and submitted clipped fill/stroke coordinates remain finite",async()=>{
  const result=await native('plot(close,"P",#ff000080,1,plot.style_area)');setValues(result.plots[0],[-1e308,null,null,null,1e308,null,null,null]);
  const {installed,f}=install(result,bars,{from:1,width:40});const found=range(installed);assert.ok(Number.isFinite(found.minValue)&&Number.isFinite(found.maxValue));assert.equal(found.minValue,-5e307);assert.equal(found.maxValue,5e307);
  const commands=f.draw(installed);assert.ok(commands.some(command=>command.kind==="fill"));for(const command of commands)for(const point of command.path)if(Array.isArray(point)){assert.ok(point.every(Number.isFinite));assert.ok(point[0]>=0&&point[0]<=40);assert.ok(point[1]>=0&&point[1]<=128);}
});

test("packed20k numeric channels retain lazy backing and bounded visible decoding across pan/resize/disposal",async()=>{
  const snapshot=Array.from({length:20000},(_,index)=>({...bars[index%bars.length],time:bars[0].time+index*60}));
  const body=["area","areabr","histogram","columns"].map(style=>`plot(close,"${style}",#ff000080,12,plot.style_${style},false,80,2)`).join("\n");
  const result=await native(body,snapshot),{adapted,f,installed}=install(result,snapshot,{from:19980,width:160});assert.equal(f.series.length,1);assert.ok(adapted.plots.every(plot=>plot.segments.length===0&&pine.getPackedPinePlot(plot.visual.source)));
  const before=installed.primitive.debugStats;f.draw(installed);range(installed);const after=installed.primitive.debugStats;assert.ok(after.decodedSamples-before.decodedSamples<120,JSON.stringify(after));
  f.pan(128);f.resize(220,180);f.draw(installed);range(installed);assert.ok(installed.primitive.debugStats.decodedSamples<250);
  const backing=pine.getPackedPinePlot(result.plots[0]);assert.equal(pine.pointAtBar(result.plots[0],19999).value,snapshot[19999].close);assert.equal(backing.numericOptions.length,0);
  installed.dispose();installed.dispose();assert.equal(f.listeners.size,0);assert.equal(installed.primitive.debugStats.cacheEntries,0);assert.equal(f.removed.length,1);
});


test("rounded column gap excludes an offscreen outlier while wide same-color histograms union alpha",async()=>{
  const result=await native('plot(close,"P",#ff000080,12,plot.style_columns)');setValues(result.plots[0],[1e9,null,null,null,null,null,null,null]);
  const gap=install(result,bars,{from:.49,width:64});assert.deepEqual(range(gap.installed),{minValue:0,maxValue:0});assert.equal(gap.f.draw(gap.installed).filter(command=>command.kind==="fill").length,0);
  const wide=await native('plot(close,"P",#ff000080,40,plot.style_histogram)');setValues(wide.plots[0],[100,100,null,null,null,null,null,null]);const merged=install(wide);const fills=merged.f.draw(merged.installed).filter(command=>command.kind==="fill");assert.equal(fills.filter(command=>hit(command,10,60)).length,1,"Overlapping same-color histogram rectangles are submitted in one fill path");
});


test("default area outline is one pixel on both small and packed histories",async()=>{
  for(const length of [8,20000]) {
    const snapshot=Array.from({length},(_,index)=>({...bars[index%bars.length],time:bars[0].time+index*60}));
    for(const style of ["area","areabr"]) {
      const result=await native(`plot(close,style=plot.style_${style})`,snapshot),{adapted,f,installed}=install(result,snapshot,{from:Math.max(0,length-8)});
      assert.equal(adapted.plots[0].width,1);const strokes=f.draw(installed).filter(command=>command.kind==="stroke");assert.ok(strokes.length);assert.ok(strokes.every(command=>command.width===1));
    }
  }
});

const guides = commands => commands.filter(command=>command.kind==="stroke"&&command.dash?.join(",")==="1,3");
test("trackprice guide-only patterns use last source value across numeric styles and both offsets",async()=>{
  for(const style of ["line","linebr","stepline","steplinebr","area","areabr","histogram","columns","circles"])for(const offset of [-99999,99999]) {
    const result=await native(`plot(close,title="Guide",color=#ff0000,style=plot.style_${style},trackprice=true,offset=${offset},show_last=1)`),{adapted,f,installed}=install(result);
    assert.deepEqual(adapted.plots[0].visual.trackPrice,{price:97,color:"#ff0000"});
    assert.deepEqual(pine.latestPineChartPoint(adapted.plots[0]),{time:bars[7].time,value:97});
    assert.ok(!adapted.adapterWarnings.some(warning=>/trackprice guide is not exposed/.test(warning)));
    const strokes=guides(f.draw(installed));assert.equal(strokes.length,1,style+" draws exactly once, including area");
    assert.deepEqual(strokes[0],{kind:"stroke",color:"#ff0000",width:1,cap:"butt",dash:[1,3],path:[[0,31],[160,31]]});
    assert.equal(range(installed).maxValue,97);f.pan(2);f.resize(220,180);
    assert.deepEqual(guides(f.draw(installed))[0].path,[[0,83],[220,83]]);
    installed.dispose();assert.equal(guides(f.draw(installed)).length,0);assert.equal(f.listeners.size,0);
  }
});

test("trackprice source show_last controls trailing na; empty and hidden plots produce no guide",async()=>{
  for(const [expression,count,expected] of [["bar_index == 7 ? na : close",1,null],["bar_index == 7 ? na : close",2,96],["na",8,null],["close",0,null],["0",1,0]]) {
    const {adapted,f,installed}=install(await native(`plot(${expression},color=#ff0000,trackprice=true,show_last=${count},offset=-99999)`));
    assert.equal(adapted.plots[0].visual.trackPrice?.price??null,expected);
    assert.equal(guides(f.draw(installed)).length,expected===null?0:1);
    assert.deepEqual(range(installed),expected===null?null:{minValue:expected,maxValue:expected});
  }
  for(const display of ["none","data_window"]) {
    const {adapted,f,installed}=install(await native(`plot(close,trackprice=true,display=display.${display})`));assert.equal(adapted.plots.length,0);assert.equal(f.series.length,0);assert.equal(installed.primitive,undefined);
  }
});

test("trackprice latest numeric sample transparency hides paint but preserves header and source color",async()=>{
  for(const shade of ["na","color.new(color.red,100)"]) {
    const {adapted,f,installed}=install(await native(`plot(close,color=bar_index == 7 ? ${shade} : #ff0000,trackprice=true,offset=-99999)`));
    assert.equal(adapted.plots[0].visual.trackPrice.price,97);assert.equal(guides(f.draw(installed)).length,0);assert.equal(range(installed),null);
    assert.equal(pine.latestPineChartPoint(adapted.plots[0]).value,97);
  }
  for(const shade of ["rgba(255,0,0,0%)","rgba(255,0,0,0.000%)"]) {
    const body='shade=input.color(color.red,"Color")\nplot(close,color=shade,trackprice=true,offset=-99999)';
    const result=await native(body,bars,{in_0:shade}),{adapted,f,installed}=install(result);
    assert.equal(result.plots[0].points.at(-1).options.color,shade);assert.equal(adapted.plots[0].visual.trackPrice.color,"rgba(0,0,0,0)");
    assert.equal(guides(f.draw(installed)).length,0);assert.equal(range(installed),null);assert.equal(pine.latestPineChartPoint(adapted.plots[0]).value,97);
  }
  const {adapted,f,installed}=install(await native('plot(close,color=bar_index == 7 ? #0000ff : #ff0000,trackprice=true,offset=-99999)'));
  assert.equal(adapted.plots[0].visual.trackPrice.color,"#0000ff");assert.equal(guides(f.draw(installed))[0].color,"#0000ff");
});

test("trackprice custom input reruns and constant flag guard leave ordinary geometry intact",async()=>{
  const body='enabled=input.bool(true,"Price guide")\nplot(close,color=#ff0000,trackprice=enabled)';
  for(const enabled of [true,false]) {const {adapted,f,installed}=install(await native(body,bars,{in_0:enabled}));assert.equal(guides(f.draw(installed)).length,enabled?1:0);assert.equal(adapted.plots[0].visual.trackPrice?.price??null,enabled?97:null);}
  for(const value of [null,1,false]) {
    const result=await native('plot(close,color=#ff0000,trackprice=true)');result.plots[0].points[3].options.trackprice=value;
    const {adapted,f,installed}=install(result);assert.ok(adapted.adapterWarnings.some(warning=>/constant boolean trackprice/.test(warning)));assert.equal(adapted.plots.length,1);assert.equal(guides(f.draw(installed)).length,0);assert.ok(f.commands.some(command=>command.kind==="stroke"));
  }
});

test("packed20k trackprice retains backing and guide redraws retain bounded visible-history decoding",async()=>{
  const snapshot=Array.from({length:20000},(_,index)=>({...bars[index%8],time:bars[0].time+index*60}));
  const {adapted,f,installed}=install(await native('plot(close,color=#ff0000,trackprice=true,offset=-99999,show_last=1)',snapshot),snapshot,{from:120});
  assert.ok(pine.getPackedPinePlot(adapted.plots[0].visual.source));assert.equal(adapted.plots[0].segments.length,0);assert.equal(adapted.plots[0].visual.trackPrice.price,snapshot.at(-1).close);
  f.draw(installed);range(installed);f.pan(15020);f.resize(220,180);f.draw(installed);range(installed);
  assert.ok(installed.primitive.debugStats.decodedSamples<=2);assert.equal(guides(f.commands).length,1);const decoded=installed.primitive.debugStats.decodedSamples;f.draw(installed);range(installed);assert.equal(installed.primitive.debugStats.decodedSamples,decoded);installed.dispose();assert.equal(installed.primitive.debugStats.cacheEntries,0);
});


test("actual circle and cross plots preserve size6 with independent one-pixel joins and native inputs",async()=>{
  for(const style of ["circles","cross"])for(const joined of [true,false]) {
    const body='enabled=input.bool(true,"Join")\nsize=input.int(6,"Size")\n'+`plot(bar_index%3==0?100:na,color=#ff000080,linewidth=size,style=plot.style_${style},join=enabled)`;
    const result=await native(body,bars,{in_0:joined,in_1:6}),oracle=await raw(body,bars,{in_0:joined,in_1:6}),{adapted,f,installed}=install(result);
    assert.equal(adapted.plots.length,1);assert.deepEqual(adapted.plots[0].visual.pointStyle,{size:6,join:joined});assert.equal(adapted.plots[0].pointsOnly,true);
    assert.deepEqual(result.plots[0].points.map(p=>p.value),oracle.plots[result.plots[0].id].data.map(p=>Number.isNaN(p.value)?null:p.value));assert.equal(pine.latestPineChartPoint(adapted.plots[0]).value,100);
    assert.ok(!adapted.adapterWarnings.some(warning=>/not rendered|limited to integer/.test(warning)));
    const commands=f.draw(installed),strokes=commands.filter(c=>c.kind==="stroke");assert.equal(strokes.length,joined?2:0);assert.ok(strokes.every(c=>c.width===1&&c.color==="#ff000080"));
    const fills=commands.filter(c=>c.kind==="fill");assert.equal(fills.length,3);
    if(style==="circles")assert.ok(fills.every(c=>c.path[0].circle[2]===7));
    else {assert.equal(fills[1].path.length,2);assert.deepEqual(fills[1].path.map(p=>p.rect),[[53,27.5,14,1],[59.5,21,1,14]]);assert.equal(fills.filter(c=>hit(c,60,28)).length,1);}
    assert.deepEqual(installed.primitive.rangeForVisible().margins,{above:7,below:7});
  }
});

test("joined points scale and draw clipped prices between sparse global centers with both offsets",async()=>{
  const global=Array.from({length:32},(_,index)=>({...bars[0],time:bars[0].time+index*60})),snapshot=[global[0],global[20]];
  for(const style of ["circles","cross"])for(const offset of [-2,2])for(const joined of [true,false]) {
    const result=await native(`plot(bar_index==0?0:100,color=#ff0000,linewidth=1,style=plot.style_${style},join=${joined},offset=${offset})`,snapshot);
    const {f,installed}=install(result,snapshot,{global,from:8+offset,width:80});
    assert.deepEqual(range(installed),joined?{minValue:40,maxValue:60}:null);
    const commands=f.draw(installed);assert.equal(commands.filter(c=>c.kind==="fill").length,0);const strokes=commands.filter(c=>c.kind==="stroke");assert.equal(strokes.length,joined?1:0);
    if(joined)assert.deepEqual(strokes[0].path,[[0,88],[80,68]]);
    f.pan(4+offset);assert.deepEqual(range(installed),joined?{minValue:20,maxValue:40}:null);installed.dispose();assert.equal(f.listeners.size,0);
  }
});

test("wide offscreen point centers still draw partial glyphs and transparent glyphs add no scale",async()=>{
  for(const style of ["circles","cross"]) {
    const {f,installed}=install(await native(`plot(bar_index==0?100:na,color=#ff0000,linewidth=40,style=plot.style_${style})`),bars,{from:1.5,width:64});
    assert.deepEqual(range(installed),{minValue:100,maxValue:100});assert.ok(f.draw(installed).some(c=>c.kind==="fill"));
    f.pan(3);assert.equal(range(installed),null);assert.equal(f.draw(installed).filter(c=>c.kind==="fill").length,0);
    for(const shade of ["na","color.new(color.red,100)"]) {
      const hidden=install(await native(`plot(close,color=${shade},linewidth=6,style=plot.style_${style},join=true)`));assert.equal(range(hidden.installed),null);assert.equal(hidden.f.draw(hidden.installed).length,0);assert.equal(pine.latestPineChartPoint(hidden.adapted.plots[0]).value,97);
    }
  }
});

test("point joins retain source show_last and endpoint-color transparency without inventing hidden glyphs",async()=>{
  for(const style of ["circles","cross"]) {
    const body=`plot(bar_index==0?90:bar_index==3?110:na,color=bar_index==3?na:#ff0000,linewidth=6,style=plot.style_${style},join=true)`;
    const first=install(await native(body));assert.equal(first.f.draw(first.installed).filter(c=>c.kind==="stroke").length,0);assert.equal(first.f.commands.filter(c=>c.kind==="fill").length,1);assert.deepEqual(range(first.installed),{minValue:90,maxValue:90});
    const later=install(await native(`plot(bar_index==0?90:bar_index==3?110:na,color=bar_index==0?na:#0000ff,linewidth=6,style=plot.style_${style},join=true)`));assert.equal(later.f.draw(later.installed).filter(c=>c.kind==="stroke").length,1);assert.deepEqual(range(later.installed),{minValue:90,maxValue:110});
    const limited=install(await native(`plot(close,color=#ff0000,linewidth=6,style=plot.style_${style},join=true,show_last=1,offset=-2)`));assert.equal(limited.f.draw(limited.installed).filter(c=>c.kind==="stroke").length,0);assert.equal(limited.f.commands.filter(c=>c.kind==="fill").length,1);assert.deepEqual(range(limited.installed),{minValue:97,maxValue:97});
    const zero=install(await native(`plot(close,color=#ff0000,style=plot.style_${style},join=true,show_last=0)`));assert.equal(range(zero.installed),null);assert.equal(zero.f.draw(zero.installed).length,0);
  }
});

test("point size safety and join guards retain valid bodies and source ownership",async()=>{
  for(const style of ["circles","cross"]) {
    for(const size of [0,null,1.5,Infinity]) {const result=await native(`plot(close,style=plot.style_${style})`);result.plots[0].options.linewidth=size;const adapted=pine.adaptPineChartResult(result,bars);assert.equal(adapted.plots.length,0);assert.ok(adapted.adapterWarnings.some(w=>/relative size/.test(w)));}
    const size=await native(`plot(close,linewidth=6,style=plot.style_${style})`);size.plots[0].points[3].options.linewidth=7;assert.equal(pine.adaptPineChartResult(size,bars).plots.length,0);
    for(const flag of [null,1,false]) {const result=await native(`plot(close,color=#ff0000,linewidth=6,style=plot.style_${style},join=true)`);result.plots[0].points[3].options.join=flag;const {adapted,f,installed}=install(result);assert.equal(adapted.plots[0].visual.pointStyle.join,false);assert.ok(adapted.adapterWarnings.some(w=>/constant boolean join/.test(w)));assert.equal(f.draw(installed).filter(c=>c.kind==="stroke").length,0);assert.ok(f.commands.some(c=>c.kind==="fill"));}
  }
});

test("packed20k point joins retain backing and bounded normal-sized viewport decoding",async()=>{
  const snapshot=Array.from({length:20000},(_,index)=>({...bars[index%8],time:bars[0].time+index*60}));
  for(const style of ["circles","cross"]) {
    const {adapted,f,installed}=install(await native(`plot(bar_index%3==0?close:na,color=#ff000080,linewidth=6,style=plot.style_${style},join=true,offset=2)`,snapshot),snapshot,{from:120,width:160});
    assert.ok(pine.getPackedPinePlot(adapted.plots[0].visual.source));assert.equal(adapted.plots[0].segments.length,0);assert.equal(f.series.length,1);
    f.draw(installed);range(installed);assert.ok(installed.primitive.debugStats.decodedSamples<20);f.pan(15020);f.resize(220,180);f.draw(installed);range(installed);assert.ok(installed.primitive.debugStats.decodedSamples<40);
    installed.dispose();installed.dispose();assert.equal(installed.primitive.debugStats.cacheEntries,0);assert.equal(f.listeners.size,0);assert.equal(f.removed.length,1);
  }
});
