import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import fs from "node:fs";
import {build} from "esbuild";
import {createPineEnginePlugin} from "../../scripts/pine-engine.mjs";
import {bars116,fillSource116} from "./fixtures/pine-fill-offset116.mjs";
Error.stackTraceLimit=0;
const bundle=(await build({bundle:true,minify:true,platform:"browser",format:"esm",write:false,logLevel:"silent",plugins:[createPineEnginePlugin()],define:{"import.meta.env":"{}"},stdin:{contents:'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pinePacked.ts";',loader:"ts",resolveDir:new URL("../../",import.meta.url).pathname,sourcefile:"pine-fill-offset116.ts"}})).outputFiles[0].text;
console.info("FILL116_BINDING "+JSON.stringify({minify:true,sealed:true,bundleSha256:createHash("sha256").update(bundle).digest("hex"),manifestSha256:createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json",import.meta.url))).digest("hex")}));
const pine=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const run=(source,bars=bars116,inputs={})=>pine.executePineRequest({id:"fill116",action:"run",source,bars,inputs,context:{symbol:"CHART:TEST",timeframe:"1",mintick:.01,pointvalue:1}});

function harness(result,{bars=bars116,timeline=bars,from=-4,to=12,width=300,height=240,pixelOrigin=0,pixelSpacing}={}) {
 const indices=new Map(timeline.map((bar,i)=>[bar.time,i])),listeners=new Set(),paths=[],gradients=[],removed=[];
 const spacing=()=>pixelSpacing??width/(to-from);
 const x=logical=>pixelOrigin+(logical-from)*spacing(),price=value=>180-value*5;
 const scale={getVisibleLogicalRange:()=>({from,to}),getVisibleRange:()=>({from:timeline[Math.max(0,Math.floor(from))]?.time,to:timeline[Math.min(timeline.length-1,Math.ceil(to))]?.time}),
  timeToCoordinate:time=>indices.has(time)?x(indices.get(time)):null,logicalToCoordinate:i=>Number.isInteger(i)?x(i):null,coordinateToLogical:pixel=>Math.round(from+(pixel-pixelOrigin)/spacing()),
  subscribeVisibleTimeRangeChange:fn=>listeners.add(fn),unsubscribeVisibleTimeRangeChange:fn=>listeners.delete(fn),subscribeVisibleLogicalRangeChange:fn=>listeners.add(fn),unsubscribeVisibleLogicalRangeChange:fn=>listeners.delete(fn)};
 const chart={timeScale:()=>scale,paneSize:()=>({width,height}),removeSeries:series=>removed.push(series),addLineSeries:options=>({
  options:()=>options,setData(){},priceToCoordinate:price,attachPrimitive(primitive){primitive.attached({chart,series:this,requestUpdate(){}});},detachPrimitive:primitive=>primitive.detached(),
  subscribeDataChanged:fn=>listeners.add(fn),unsubscribeDataChanged:fn=>listeners.delete(fn)}),
  subscribeSizeChange:fn=>listeners.add(fn),unsubscribeSizeChange:fn=>listeners.delete(fn)};
 const adapted=pine.adaptPineChartResult(result,bars),installed=pine.installPineChartPlots(chart,adapted.plots);
 const ctx={save(){},restore(){},beginPath(){this.path=[];},moveTo(x,y){this.path.push([x,y]);},lineTo(x,y){this.path.push([x,y]);},closePath(){},rect(){},clip(){},setLineDash(){},stroke(){},
  fill(){paths.push({color:this.fillStyle,vertices:[...this.path]});},createLinearGradient(x0,y0,x1,y1){const gradient={from:[x0,y0],to:[x1,y1],stops:[],addColorStop(at,color){this.stops.push([at,color]);}};gradients.push(gradient);return gradient;}};
 return {adapted,installed,listeners,removed,x,price,paths,gradients,
  draw(){paths.length=0;gradients.length=0;installed.primitive?.updateAllViews();for(const view of installed.primitive?.paneViews()??[]){const renderer=view.renderer();renderer?.drawBackground?.({useMediaCoordinateSpace:fn=>fn({context:ctx,mediaSize:{width,height}})});renderer?.draw({useMediaCoordinateSpace:fn=>fn({context:ctx,mediaSize:{width,height}})});}return paths;},
  pan(left,right){from=left;to=right;for(const listener of listeners)listener();}};
}
function contains(vertices,x,y) {
 let inside=false;
 for(let i=0,j=vertices.length-1;i<vertices.length;j=i++) {const [xi,yi]=vertices[i],[xj,yj]=vertices[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}
 return inside;
}
const covers=(h,logical,value,color)=>h.paths.some(path=>(color===undefined||path.color===color)&&contains(path.vertices,h.x(logical),h.price(value)));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,JSON.stringify({actual:a,expected:b}));

test("saved constant positive and negative plot offsets retain a genuinely painted fill",async()=>{
 for(const version of [5,6])for(const offset of [-2,2]) {
  const source=fillSource116({version,inputs:true}),result=await run(source,bars116,{in_0:offset});
  assert.equal(result.source,source);assert.deepEqual(result.inputs,{in_0:offset});assert.equal(result.plots.length,3);
  const h=harness(result);
  assert.equal(h.adapted.plots.filter(plot=>plot.kind==="fill").length,1,JSON.stringify(h.adapted.adapterWarnings));
  h.draw();assert.ok(covers(h,3.5+offset,5.25,"#ff0000"),"Actual Canvas fill must follow the shifted plot-ID boundaries.");
  assert.ok(!covers(h,-.5+offset,5.25),"No fill before retained shifted reference domain.");
  h.installed.dispose();
 }
});


test("independently shifted slopes share target slots while the declared first reference anchors colors",async()=>{
 for(const reverse of [false,true]) {
  const result=await run(fillSource116({upperOffset:1,lowerOffset:0,color:"bar_index%2==0?#ff0000:#0000ff",reverse}));
  const h=harness(result);h.draw();
  // At target3.5: upper=15, lower=-6.5. Right-hand shade belongs
  // to original source3 for a,b and original source4 for b,a.
  assert.ok(covers(h,3.5,4.25,reverse?"#ff0000":"#0000ff"));
  assert.ok(!covers(h,.5,4.25));assert.ok(!covers(h,7.5,4.25));
  h.installed.dispose();
 }
});

test("fractional viewport clipping paints both edge fragments and scales only their exact slope values",async()=>{
 const h=harness(await run(fillSource116({upperOffset:1,lowerOffset:0})),{from:2.25,to:4.75});
 h.draw();
 assert.ok(covers(h,2.5,4),"The first fractional viewport fragment must paint through integer-only LWC coordinates.");
 assert.ok(covers(h,4.5,4),"The last fractional viewport fragment must paint.");
 const range=h.installed.primitive.rangeForVisible().priceRange;
 near(range.minValue,-7.75);near(range.maxValue,17.5);
 h.installed.dispose();
});

test("sparse source times interpolate across actual chart logical slots, including opposite displacements",async()=>{
 const sparse=[bars116[0],bars116[3],bars116[7]];
 const result=await run(fillSource116({upper:"10+10*bar_index",lower:"-10+5*bar_index",upperOffset:2,lowerOffset:-1}),sparse);
 const h=harness(result,{bars:sparse,timeline:bars116,from:3,to:5});
 h.draw();assert.ok(covers(h,4,5));
 const range=h.installed.primitive.rangeForVisible().priceRange;
 near(range.minValue,-3.75);near(range.maxValue,20);
 h.installed.dispose();
});

test("source-first fill and reference show_last cuts travel to future and past slots",async()=>{
 for(const offset of [-2,2]) {
  const h=harness(await run(fillSource116({upperOffset:offset,upperFlags:",show_last=2",lowerFlags:",show_last=4",fillFlags:",show_last=3"})));
  h.draw();assert.ok(covers(h,6.5+offset,5));
  assert.ok(!covers(h,5.5+offset,5));assert.ok(!covers(h,7.5+offset,5));
  const range=h.installed.primitive.rangeForVisible().priceRange;
  near(range.minValue,-4);near(range.maxValue,24);
  h.installed.dispose();
 }
});

test("fillgaps bridges actual shifted missing values only when requested",async()=>{
 for(const bridge of [false,true]) {
  const h=harness(await run(fillSource116({upper:"bar_index==3?na:10+2*bar_index",lower:"-10",upperOffset:2,fillFlags:",fillgaps="+bridge})));
  h.draw();assert.equal(covers(h,4.5,5),bridge);assert.equal(covers(h,5.5,5),bridge);
  assert.ok(covers(h,6.5,5));assert.ok(!covers(h,1.5,5));h.installed.dispose();
 }
});

test("transparent source colors create shifted holes without leaking adjacent shades",async()=>{
 const h=harness(await run(fillSource116({upperOffset:2,color:"bar_index==3?na:#ff0000"})));
 h.draw();assert.ok(!covers(h,4.5,5));assert.ok(covers(h,5.5,5,"#ff0000"));h.installed.dispose();
});

test("shifted gradient uses price stops and the upper-reference source color",async()=>{
 const h=harness(await run(fillSource116({upper:"30",lower:"-10",upperOffset:2,lowerOffset:0,gradient:"20,0,#ff0000,#0000ff"})));
 h.draw();assert.ok(covers(h,3.5,10));assert.ok(h.gradients.length>0);
 const gradient=h.gradients.find(g=>g.stops.length===2);
 assert.ok(gradient);near(gradient.from[1],h.price(20));near(gradient.to[1],h.price(0));
 assert.match(gradient.stops[0][1],/255,\s*0,\s*0/);assert.match(gradient.stops[1][1],/0,\s*0,\s*255/);
 h.installed.dispose();
});

test("crossing shifted boundaries paint both lobes without filling the wrong side",async()=>{
 const h=harness(await run(fillSource116({upper:"bar_index%2==0?8:2",lower:"5",upperOffset:1,lowerOffset:0})));
 h.draw();assert.ok(covers(h,1.25,6));assert.ok(!covers(h,1.75,6));assert.ok(covers(h,1.75,4));h.installed.dispose();
});

test("hidden referenced offsets remain strictly validated instead of producing an unshifted fill",async()=>{
 const result=await run(fillSource116());
 for(const invalid of [1.5,null,"2"]) {
  const broken=structuredClone(result);broken.plots[0].options.offset=invalid;
  const adapted=pine.adaptPineChartResult(broken,bars116);
  assert.equal(adapted.plots.filter(p=>p.kind==="fill").length,0);
  assert.match(adapted.adapterWarnings.join(" "),/offset/i);
 }
 const changing=structuredClone(result);
 const source=changing.plots[0];
 if(source.points?.length)source.points[3].options={...source.points[3].options,offset:3};
 else throw new Error("Native source fixture must retain authored sample metadata.");
 assert.equal(pine.adaptPineChartResult(changing,bars116).plots.filter(p=>p.kind==="fill").length,0);
});

test("packed 20k histories pan with bounded projection and dispose all subscriptions",async()=>{
 const bars=Array.from({length:20000},(_,i)=>({...bars116[0],time:bars116[0].time+i*60}));
 const result=await run(fillSource116({upper:"bar_index+20",lower:"bar_index-20",upperOffset:5,lowerOffset:-3}),bars);
 for(const plot of result.plots)assert.ok(pine.getPackedPinePlot(plot));
 const h=harness(result,{bars,from:10000,to:10020});h.draw();
 let range=h.installed.primitive.rangeForVisible().priceRange;
 near(range.minValue,9983);near(range.maxValue,10035);
 const first=h.installed.primitive.debugStats;
 assert.ok(first.decodedSamples<300);assert.ok(first.cacheEntries<600);
 h.pan(15000,15020);h.draw();range=h.installed.primitive.rangeForVisible().priceRange;
 near(range.minValue,14983);near(range.maxValue,15035);
 const second=h.installed.primitive.debugStats;
 assert.ok(second.decodedSamples-first.decodedSamples<300);assert.ok(second.cacheEntries<600);
 assert.ok(h.listeners.size>0);h.installed.dispose();h.installed.dispose();
 assert.equal(h.listeners.size,0);assert.equal(h.removed.length,1);assert.equal(h.installed.primitive.debugStats.cacheEntries,0);
});


test("actual LWC pane edges include half-slot outliers without scaling to their offscreen peaks",async()=>{
 // Pinned LWC: advertised [2,6], x(2)=9, x(6)=89, pane100.
 // Physical visible logical domain [1.55,6.55], not [2,6].
 const result=await run(fillSource116({upper:"bar_index==0 or bar_index==6?1000:20",lower:"0",upperOffset:1,lowerOffset:0}));
 const h=harness(result,{from:2,to:6,width:100,pixelOrigin:9,pixelSpacing:20});h.draw();
 const range=h.installed.primitive.rangeForVisible().priceRange;
 near(range.minValue,0);near(range.maxValue,559);
 assert.ok(covers(h,1.7,30),"Left strip outside advertised center range is visible.");
 assert.ok(covers(h,6.3,30),"Right strip outside advertised center range is visible.");
 assert.ok(!covers(h,6.8,30),"Off-pane continuation must be clipped.");
 h.installed.dispose();
});
