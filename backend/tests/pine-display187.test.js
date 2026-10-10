import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle:true, minify:true, write:false, format:"esm", platform:"browser", target:"es2020", logLevel:"silent",
  plugins:[createPineEnginePlugin()], stdin:{loader:"ts",resolveDir:process.cwd(),sourcefile:"pine-display187.ts",contents:
    'export * from "./frontend/src/workers/pineNative.worker";export * from "./frontend/src/lib/pinePacked";export * from "./frontend/src/lib/pineChartAdapter";export * from "./frontend/src/lib/pineDisplay";export * from "./frontend/src/lib/pineProtocol";'} })).outputFiles[0].text;
const hash = value => createHash("sha256").update(value).digest("hex");
console.info("DISPLAY187_BINDING "+JSON.stringify({minified:true,actualWorker:true,bundleSha256:hash(bundle),manifestSha256:hash(fs.readFileSync("frontend/vendor/pinets/manifest.json"))}));
const api = await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024,0,1)/1000;
const bars = Array.from({length:12},(_,i)=>({time:origin+i*60,open:100+i,high:103+i,low:98+i,close:101+i,volume:10+i}));
const context = {symbol:"BINANCE:BTCUSDT",timeframe:"1",mintick:.01,pointvalue:1};
// Independent membership oracle. Official plot* display destinations are four
// distinct surfaces. Hidden values still calculate and cannot alter price scale:
// https://www.tradingview.com/pine-script-docs/visuals/plots/
const destinations = ["pane","data_window","status_line","price_scale"];
const expression = mask => mask===0 ? "display.none" : mask===15 ? "display.all" : destinations.filter((_,i)=>mask&(1<<i)).map(name=>"display."+name).join("+");
const encoded = mask => mask===0?"none":mask===15?"all":destinations.filter((_,i)=>mask&(1<<i)).join("");
const source = (body,version=6,declaration='indicator("Display187",overlay=true)') => `//@version=${version}\n${declaration}\n${body}`;
const run = (body,version=6,data=bars,declaration) => api.executePineRequest({id:"display187",action:"run",mode:"historical",source:source(body,version,declaration),inputs:{},bars:data,context});
const points = plot => Array.from({length:api.getPackedPinePlot(plot)?.slots??plot.points.length},(_,i)=>api.getPackedPinePlot(plot)?api.pointAtBar(plot,i):plot.points[i]);

test("v5/v6 all 16 genuine native destination sets retain independent raw values and authored identities",async()=>{
  for(const version of [5,6]) {
    const result=await run(Array.from({length:16},(_,mask)=>`plot(close+${mask},"M${mask}",display=${expression(mask)})`).join("\n"),version);
    assert.equal(result.plots.length,16);assert.equal(new Set(result.plots.map(plot=>plot.id)).size,16);
    for(let mask=0;mask<16;mask++) {
      const plot=result.plots[mask];assert.equal(plot.options.display,encoded(mask),"mask "+mask);
      assert.deepEqual(points(plot).map(point=>point.value),bars.map(bar=>bar.close+mask));
      assert.deepEqual(points(plot).map(point=>point.time),bars.map(bar=>bar.time));
    }
  }
});

test("native display subtraction, redundant unions and declaration defaults preserve all four destinations",async()=>{
  const calls=['display.all-display.pane','display.all-display.data_window','display.all-display.status_line','display.all-display.price_scale',
    'display.pane+display.pane','display.all-display.all','display.none+display.price_scale','display.all-display.pane-display.price_scale'];
  for(const version of [5,6]) {
    const result=await run('plot(close,"Default")\n'+calls.map((value,i)=>`plot(close,"E${i}",display=${value})`).join("\n"),version);
    // Missing raw display is the native all default; enum arithmetic has exact canonical strings.
    assert.ok(result.plots[0].options.display===undefined || result.plots[0].options.display==="all");
    assert.deepEqual(result.plots.slice(1).map(plot=>plot.options.display),[encoded(14),encoded(13),encoded(11),encoded(7),encoded(1),encoded(0),encoded(8),encoded(6)]);
  }
});

test("packed and unpacked show_last retain exact NA, boolean, OHLC and duplicate channels without synthetic future timestamps",async()=>{
  const body='plot(bar_index%2==0?na:close,"Same",show_last=2,offset=3,display=display.data_window+display.status_line)\nplot(close+1,"Same",display=display.price_scale)\nplotshape(bar_index%2==0,"Bool",display=display.data_window)\nplotbar(open,high,low,close,"OHLC",display=display.none)';
  for(const count of [12,5000]) {
    const data=Array.from({length:count},(_,i)=>({...bars[i%bars.length],time:origin+i*60})),result=await run(body,6,data);
    assert.equal(new Set(result.plots.map(plot=>plot.id)).size,4);assert.equal(Boolean(api.getPackedPinePlot(result.plots[0])),count===5000);
    const actual=result.plots.map(points);assert.equal(actual[0].length,count);
    for(const i of [0,1,count-2,count-1]) {
      assert.equal(actual[0][i].value,i%2===0?null:data[i].close);
      assert.equal(actual[1][i].value,data[i].close+1);assert.equal(actual[2][i].value,i%2===0);
      assert.deepEqual(actual[3][i].value,[data[i].open,data[i].high,data[i].low,data[i].close]);
      assert.ok(actual.every(channel=>channel[i].time===data[i].time));
    }
    assert.equal(result.plots[0].options.show_last,2);assert.equal(result.plots[0].options.offset,3);
  }
});

test("hidden plots preserve fill references and actual armed raw condition values before display filtering",async()=>{
  const body='alertcondition(close>open,"Visible condition","{{plot_0}}")\na=plot(close,"Hidden",display=display.none)\nb=plot(close+1,"Hidden",display=display.none)\nfill(a,b,color=#00ff0040)';
  const session=api.createPineLiveExecutor(),sessionId="display187-hidden";
  try {
    const initial=await session.execute({protocol:"pine-live-v1",sessionId,sequence:0,action:"start",request:{id:sessionId+":0",action:"run",mode:"live",source:source(body),inputs:{},bars,context}});
    assert.equal(Object.hasOwn(initial,"conditionSamples"),false);
    const bar={...bars.at(-1),time:origin+12*60,close:115,high:116};
    const result=await session.execute({protocol:"pine-live-v1",sessionId,sequence:1,action:"update",bar,confirmed:false,collectConditions:true});
    assert.deepEqual(result.conditionSamples.samples[0].plots.numbered,[115,116]);
    const fill=result.plots.find(plot=>plot.style==="fill");assert.ok(fill);
    assert.notEqual(fill.options.plot1,fill.options.plot2);assert.ok(result.plots.some(plot=>plot.id===fill.options.plot1));assert.ok(result.plots.some(plot=>plot.id===fill.options.plot2));
    assert.deepEqual(result.conditionSamples.samples[0].conditions,[true]);
  } finally { session.dispose(); }
});


test("destination admission consumes the entire native string and pane eligibility is independent from readout identity",async()=>{
  for(let mask=0;mask<16;mask++)assert.deepEqual(api.parsePineDisplay(encoded(mask)),destinations.filter((_,i)=>mask&(1<<i)));
  assert.deepEqual(api.parsePineDisplay(),destinations);
  for(const invalid of [null,0,true,"","paneUNKNOWN","price_scale garbage","data_windowevil","all;none","display.pane+display.data_window",{},"pane".repeat(65)])assert.equal(api.parsePineDisplay(invalid),undefined,String(invalid));
  const result=await run(Array.from({length:16},(_,mask)=>`plot(close+${mask},"M${mask}",display=${expression(mask)})`).join("\n"));
  const adapted=api.adaptPineChartResult(result,bars);
  assert.deepEqual(adapted.plots.map(plot=>plot.id),result.plots.filter((_,mask)=>mask&1).map(plot=>plot.id));
  assert.equal(adapted.readouts.length,14);
  adapted.readouts.forEach(readout=>{
    const mask=result.plots.findIndex(plot=>plot.id===readout.id);assert.ok(mask&14);
    assert.equal(readout.id,result.plots[mask].id);assert.equal(readout.source,result.plots[mask]);
    assert.deepEqual(readout.destinations,destinations.filter((_,i)=>mask&(1<<i)));
    assert.deepEqual(api.samplePineChartReadout(readout,bars[4].time).values,[bars[4].close+mask]);
  });
  assert.ok(!adapted.warnings.some(warning=>/destination.*not exposed/i.test(warning)));
});

test("genuine display operators cannot launder unknown residue or non-display operands",async()=>{
  for(const version of [5,6])for(const display of ['display.pane + "garbage"','display.all - "panejunk"','display.pane + 1','display.all - na']) {
    await assert.rejects(run(`plot(close,"Hostile",display=${display})`,version),error=>
      ["COMPILE_ERROR","UNSUPPORTED_PLOT_OPTION"].includes(error.code),`v${version}: ${display}`);
  }
});

test("exact hovered NA/bool/OHLC/show_last sampling is independent of visual offsets and never revives earlier finite values",async()=>{
  const body='plot(bar_index%2==0?na:close,"Same",display=display.status_line+display.data_window,offset=4)\nplot(close+1,"Same",display=display.price_scale)\nplotshape(bar_index%2==0,"Bool",display=display.data_window)\nplotcandle(open,high,low,close,"OHLC",display=display.data_window)\nplot(close,"Cut",show_last=2,display=display.status_line)';
  for(const count of [12,5000]) {
    const data=Array.from({length:count},(_,i)=>({...bars[i%bars.length],time:origin+i*60})),result=await run(body,6,data),readouts=api.adaptPineChartResult(result,data).readouts;
    assert.equal(new Set(readouts.map(readout=>readout.id)).size,5);
    for(const i of [0,1,count-2,count-1]) {
      assert.deepEqual(api.samplePineChartReadout(readouts[0],data[i].time).values,[i%2===0?null:data[i].close]);
      assert.deepEqual(api.samplePineChartReadout(readouts[1],data[i].time).values,[data[i].close+1]);
      assert.deepEqual(api.samplePineChartReadout(readouts[2],data[i].time).values,[i%2===0?1:0]);
      assert.deepEqual(api.samplePineChartReadout(readouts[3],data[i].time).values,[data[i].open,data[i].high,data[i].low,data[i].close]);
      assert.deepEqual(api.samplePineChartReadout(readouts[4],data[i].time).values,[i<count-2?null:data[i].close]);
    }
    for(const time of [data[0].time-60,data[1].time+1,data.at(-1).time+60])assert.equal(api.samplePineChartReadout(readouts[0],time),undefined);
  }
});

test("genuine declaration format/precision metadata survives prepare/run/live, and per-plot formatting inherits only omitted defaults",async()=>{
  for(const version of [5,6]) {
    const declaration='indicator("Formatting",format=format.percent,precision=3)',body='plot(close,"Inherited")\nplot(close,"Explicit",format=format.price,precision=1)';
    const text=source(body,version,declaration),prepared=await api.executePineRequest({id:"fmt-prepare",action:"prepare",source:text});
    assert.equal(prepared.format,"percent");assert.equal(prepared.precision,3);
    const result=await run(body,version,bars,declaration),readouts=api.adaptPineChartResult(result,bars).readouts;
    assert.equal(result.format,"percent");assert.equal(result.precision,3);
    assert.equal(api.formatPineChartValue(readouts[0],12.34567),"12.346%");assert.equal(api.formatPineChartValue(readouts[1],12.34567),"12.3");
    const session=api.createPineLiveExecutor(),sessionId="format187-session-"+version;
    try {const initial=await session.execute({protocol:"pine-live-v1",sessionId,sequence:0,action:"start",request:{id:sessionId+":0",action:"run",mode:"live",source:text,inputs:{},bars,context}});
      assert.equal(initial.format,"percent");assert.equal(initial.precision,3);
    } finally {session.dispose();}
  }
  assert.equal(api.formatPineChartValue({format:"inherit"},1.234567,4),"1.2346");
  assert.equal(api.formatPineChartValue({format:"price",precision:0},12.6),"13");
  // Declaration UI formatting has two suffix digits, unlike str.tostring's separate format.volume policy.
  // https://www.tradingview.com/pine-script-docs/language/declaration-statements/
  assert.equal(api.formatPineChartValue({format:"volume"},1234600),"1.23M");
  assert.equal(api.formatPineChartValue({format:"volume",precision:8},2474),"2.47K");
  assert.equal(api.formatPineChartValue({format:"volume",precision:0},14489245),"14.49M");
  assert.equal(api.formatPineChartValue({format:"price",precision:2},14489245),"14,489,245.00");
  assert.equal(api.formatPineChartValue({format:"percent",precision:2},1224.355),"1,224.36%");
  assert.equal(api.formatPineChartValue({format:"price"},null),"—");
  for(const format of ["garbage",null,4])assert.equal(api.parsePineFormat(format),undefined);
  for(const value of ["format.price","format_price","price"])assert.equal(api.parsePineFormat(value),"price");
});


test("optional formatting metadata remains backward compatible while canonical bounds and accessor ownership fail closed",async()=>{
  const text=source('plot(close,"Format")',6,'indicator("Metadata",format=format.price,precision=4)'),request={id:"metadata187",action:"prepare",source:text};
  const prepared=await api.executePineRequest(request);
  const validate=result=>api.validatePineResponse({id:request.id,status:"completed",result},request);
  assert.equal(validate(prepared).precision,4);
  const legacy={...prepared};delete legacy.format;delete legacy.precision;
  assert.equal(Object.hasOwn(validate(legacy),"format"),false);assert.equal(Object.hasOwn(validate(legacy),"precision"),false);
  for(const format of [null,0,"unknown","format.price","price_bad"])assert.throws(()=>validate({...prepared,format}),error=>error.code==="INVALID_MESSAGE");
  for(const precision of [null,-1,1.5,17,NaN,Infinity,"4"])assert.throws(()=>validate({...prepared,precision}),error=>error.code==="INVALID_MESSAGE");
  let reads=0;const hostile={...prepared};Object.defineProperty(hostile,"precision",{enumerable:true,get(){reads++;return 4;}});
  assert.throws(()=>validate(hostile),error=>error.code==="INVALID_MESSAGE");assert.equal(reads,0);
  const copied=validate(prepared);prepared.precision=1;assert.equal(copied.precision,4);
});


test("all six native plot helpers admit every destination set with unchanged scalar/boolean/OHLC values in v5/v6",async()=>{
  const helpers=[['plot',mask=>`plot(close,"H${mask}",display=${expression(mask)})`,bar=>bar.close],
    ['plotbar',mask=>`plotbar(open,high,low,close,"H${mask}",display=${expression(mask)})`,bar=>[bar.open,bar.high,bar.low,bar.close]],
    ['plotcandle',mask=>`plotcandle(open,high,low,close,"H${mask}",display=${expression(mask)})`,bar=>[bar.open,bar.high,bar.low,bar.close]],
    ['plotshape',mask=>`plotshape(close>open,"H${mask}",display=${expression(mask)})`,()=>true],
    ['plotchar',mask=>`plotchar(close>open,"H${mask}",char="A",display=${expression(mask)})`,()=>true],
    ['plotarrow',mask=>`plotarrow(close-open,"H${mask}",display=${expression(mask)})`,bar=>bar.close-bar.open]];
  for(const version of [5,6])for(const [name,call,expected] of helpers){
    const result=await run(Array.from({length:16},(_,mask)=>call(mask)).join("\n"),version);assert.equal(result.plots.length,16,name);
    for(let mask=0;mask<16;mask++) {
      assert.equal(result.plots[mask].options.display,encoded(mask),name+" mask "+mask);
      assert.deepEqual(points(result.plots[mask]).map(point=>point.value),bars.map(expected),name+" raw values");
    }
  }
});
