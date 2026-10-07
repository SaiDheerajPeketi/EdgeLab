import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
const bundle = buildSync({ bundle:true,format:"esm",platform:"browser",write:false,logLevel:"silent",stdin:{
  contents:'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export {Indicator,PineTS} from "pinets";',
  loader:"ts",resolveDir:fileURLToPath(new URL("../..",import.meta.url)),sourcefile:"pine-numeric-oracles.ts",
}}).outputFiles[0].text;
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
  const ctx={fillStyle:"",strokeStyle:"",lineWidth:1,getTransform:()=>({a:dpr}),save(){states.push({fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth});},restore(){Object.assign(this,states.pop());},beginPath(){path=[];},rect(x,y,w,h){path.push({rect:[x,y,w,h]});},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},closePath(){},clip(){},setLineDash(){},fill(){commands.push({kind:"fill",color:this.fillStyle,path:[...path]});},stroke(){commands.push({kind:"stroke",color:this.strokeStyle,width:this.lineWidth,path:[...path]});},createLinearGradient(){assert.fail("Numeric area fills must be flat, not gradients");}};
  const target={useMediaCoordinateSpace:fn=>fn({context:ctx,mediaSize:{width,height}})};
  return {chart,series,removed,listeners,commands,draw(installed){commands.length=0;for(const view of installed.primitive.paneViews())view.renderer()?.draw(target);return commands;},pan(next){from=next;for(const fn of listeners)fn();},zoom(next){spacing=next;for(const fn of listeners)fn();},resize(w,h){width=w;height=h;},coordinate};
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
