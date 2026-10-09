import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const root = new URL("../../", import.meta.url).pathname;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser",
  target: "es2020", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export {validatePineRequest,PINE_LIMITS} from "./frontend/src/lib/pineProtocol.ts"; export {pineSourceSnapshotForChart} from "./frontend/src/lib/pineSourceSnapshot.ts"; export {chartRuntimeOwnerMatches} from "./frontend/src/lib/chartRuntimeOwnership.ts";',
    resolveDir: root, sourcefile: "pine-lower-timeframe112.ts", loader: "ts" },
})).outputFiles[0].text;
console.info("LOWER112_BINDING " + JSON.stringify({ minify: true, sealed: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));

const start=1_700_000_100;
assert.equal(start%300,0);
let randomState=0x112;
const minuteBars=Array.from({length:40},(_,i)=>{
  const next=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState;};
  const open=80+next()%41,close=80+next()%41;
  return {time:start+i*60,open,high:Math.max(open,close)+1+next()%6,low:Math.min(open,close)-1-next()%6,close,volume:100+next()%201};
});
function aggregateFive(snapshot) {
  return Array.from({length:Math.ceil(snapshot.length/5)},(_,i)=>{
    const group=snapshot.slice(i*5,i*5+5);
    return {time:group[0].time,open:group[0].open,high:Math.max(...group.map(bar=>bar.high)),low:Math.min(...group.map(bar=>bar.low)),close:group.at(-1).close,volume:group.reduce((sum,bar)=>sum+bar.volume,0)};
  });
}
const chartBars=aggregateFive(minuteBars);
const context={symbol:"CHART:TEST",timeframe:"5",mintick:.01,pointvalue:1};
const original=(body,version=6,dynamic=false)=>"//@version="+version+'\nindicator("Lower112"'+(dynamic==="default"?"":",dynamic_requests="+dynamic)+")\n"+body;
const run=(body,{version=6,dynamic=false,inputs={},action="run",snapshot=minuteBars,chart=chartBars,mode="historical",sourceSnapshot={timeframe:"1",bars:snapshot},ctx=context,declaration}={})=>
  pine.executePineRequest({id:"lower112",action,source:declaration?"//@version="+version+"\n"+declaration+"\n"+body:original(body,version,dynamic),inputs,mode,...(action==="run"?{bars:chart,context:ctx,...(sourceSnapshot===null?{}:{sourceSnapshot})}:{})});
const values=(result,name)=>result.plots.find(item=>item.name===name).points.map(point=>point.value);

test("historical lower security selects actual first and last owned minute intrabars",async()=>{
  const body='plot(request.security("CHART:TEST","1",close,lookahead=barmerge.lookahead_on),"First")\nplot(request.security("CHART:TEST","1",close,lookahead=barmerge.lookahead_off),"Last")';
  for(const version of [5,6]) {
    const result=await run(body,{version});
    assert.deepEqual(values(result,"First"),chartBars.map((_,i)=>minuteBars[i*5].close));
    assert.deepEqual(values(result,"Last"),chartBars.map((_,i)=>minuteBars[i*5+4].close));
  }
});

test("lower_tf returns all actual minute intrabars in ascending order",async()=>{
  const body='intrabar=request.security_lower_tf("CHART:TEST","1",close)\nplot(array.size(intrabar),"Count")\nplot(array.get(intrabar,0),"First")\nplot(array.get(intrabar,array.size(intrabar)-1),"Last")';
  for(const version of [5,6]) {
    const result=await run(body,{version});
    assert.deepEqual(values(result,"Count"),chartBars.map(()=>5));
    assert.deepEqual(values(result,"First"),chartBars.map((_,i)=>minuteBars[i*5].close));
    assert.deepEqual(values(result,"Last"),chartBars.map((_,i)=>minuteBars[i*5+4].close));
  }
});


const policies=[{version:5,dynamic:"default"},{version:5,dynamic:false},{version:6,dynamic:false},{version:6,dynamic:true}];
const members=(snapshot,chart=chartBars,duration=300)=>chart.map(bar=>snapshot.filter(child=>child.time>=bar.time&&child.time<bar.time+duration));
const closes=minuteBars.map(bar=>bar.close);
const cumulative=closes.map((_,i)=>closes.slice(0,i+1).reduce((sum,value)=>sum+value,0));
const sma=(series,length)=>series.map((_,i)=>i<length-1?null:series.slice(i-length+1,i+1).reduce((sum,value)=>sum+value,0)/length);
const assertNumbers=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((value,i)=>expected[i]===null?assert.equal(value,null):assert.ok(Math.abs(value-expected[i])<=1e-9,JSON.stringify({index:i,actual:value,expected:expected[i]})));};
const protocolRequest=(sourceSnapshot,extra={})=>({id:"lower112-protocol",action:"run",source:original('plot(close,"Close")'),inputs:{},bars:chartBars,context,sourceSnapshot,...extra});
function complete(snapshot,minutes) {
  const duration=minutes*60,groups=new Map();
  for(const bar of snapshot) { const time=Math.floor(bar.time/duration)*duration; if(!groups.has(time))groups.set(time,[]);groups.get(time).push(bar); }
  return [...groups].sort((a,b)=>a[0]-b[0]).flatMap(([time,group])=>group.length!==minutes||group.some((bar,i)=>bar.time!==time+i*60)?[]:
    [{time,open:group[0].open,high:Math.max(...group.map(bar=>bar.high)),low:Math.min(...group.map(bar=>bar.low)),close:group.at(-1).close,volume:group.reduce((sum,bar)=>sum+bar.volume,0)}]);
}
const requireError=(body,options,code)=>assert.rejects(run(body,options),error=>{assert.equal(error.code,code,error.message);return true;});

test("every returned intrabar slot follows timestamp order rather than price or chart aggregation",async()=>{
  const body='a=request.security_lower_tf("CHART:TEST","1",close)\n'+Array.from({length:5},(_,i)=>'plot(array.get(a,'+i+'),"Slot'+i+'")').join("\n");
  for(const policy of policies) {
    const result=await run(body,policy);
    for(let i=0;i<5;i++)assert.deepEqual(values(result,"Slot"+i),chartBars.map((_,group)=>minuteBars[group*5+i].close));
    for(const output of result.plots)assert.deepEqual(output.points.map(point=>point.time),chartBars.map(bar=>bar.time));
  }
});

test("lower expressions evaluate the actual intrabar OHLCV values",async()=>{
  const body='a=request.security_lower_tf("CHART:TEST","1",open+2*high+3*low+4*close+volume/10)\nplot(array.get(a,0),"First")\nplot(array.get(a,4),"Last")';
  const expression=bar=>bar.open+2*bar.high+3*bar.low+4*bar.close+bar.volume/10;
  for(const policy of policies) {
    const result=await run(body,policy);
    assert.deepEqual(values(result,"First"),chartBars.map((_,i)=>expression(minuteBars[i*5])));
    assert.deepEqual(values(result,"Last"),chartBars.map((_,i)=>expression(minuteBars[i*5+4])));
  }
});

test("remote cumulative and SMA histories use minute bars and preserve native saved input IDs",async()=>{
  const body='length=input.int(2,"Length",minval=1,maxval=10)\nf()=>ta.sma(close,length)\nplot(request.security("CHART:TEST","1",ta.cum(close)),"Cum")\na=request.security_lower_tf(expression=f(),timeframe="1",symbol="CHART:TEST")\nplot(array.get(a,0),"First SMA")\nplot(array.get(a,4),"Last SMA")';
  for(const policy of policies) {
    const prepared=await run(body,{...policy,action:"prepare"});
    assert.deepEqual(prepared.inputDefinitions.map(item=>[item.id,item.defval]),[["in_0",2]]);
    for(const length of [2,3]) {
      const inputs=JSON.parse(JSON.stringify({in_0:length})),result=await run(body,{...policy,inputs}),moving=sma(closes,length);
      assert.deepEqual(result.inputs,inputs);assert.equal(result.source,original(body,policy.version,policy.dynamic));
      assert.deepEqual(values(result,"Cum"),chartBars.map((_,i)=>cumulative[i*5+4]));
      assertNumbers(values(result,"First SMA"),chartBars.map((_,i)=>moving[i*5]));
      assertNumbers(values(result,"Last SMA"),chartBars.map((_,i)=>moving[i*5+4]));
    }
  }
});

test("tuples are separate ordered arrays with real time, history and executing-context metadata",async()=>{
  const body='f()=>[close,close[1],time,time_close,timeframe.period,syminfo.tickerid]\n[c,p,t,tc,frame,symbol]=request.security_lower_tf("CHART:TEST","1",f())\nplot(array.size(c),"Count")\nplot(array.get(c,4),"Close")\nplot(array.get(p,0),"Previous")\nplot(array.get(t,0),"Open time")\nplot(array.get(tc,4),"Close time")\nplot(array.get(frame,0)=="1"?1:0,"Frame")\nplot(array.get(symbol,0)=="CHART:TEST"?1:0,"Symbol")';
  for(const policy of policies) {
    const result=await run(body,policy);
    assert.deepEqual(values(result,"Count"),chartBars.map(()=>5));
    assert.deepEqual(values(result,"Close"),chartBars.map((_,i)=>closes[i*5+4]));
    assert.deepEqual(values(result,"Previous"),chartBars.map((_,i)=>i===0?null:closes[i*5-1]));
    assert.deepEqual(values(result,"Open time"),chartBars.map(bar=>bar.time*1000));
    assert.deepEqual(values(result,"Close time"),chartBars.map(bar=>(bar.time+300)*1000));
    assert.deepEqual(values(result,"Frame"),chartBars.map(()=>1));assert.deepEqual(values(result,"Symbol"),chartBars.map(()=>1));
  }
});

test("missing and retained-prefix minute data yields actual fewer or empty arrays without invented bars",async()=>{
  const snapshot=minuteBars.filter((_,i)=>i>=2&&!(i>=5&&i<10)&&i<38);
  const groups=members(snapshot);
  const body='a=request.security_lower_tf("CHART:TEST","1",close)\nplot(array.size(a),"Count")\nplot(array.size(a)>0?array.get(a,0):na,"First")\nplot(array.size(a)>0?array.get(a,array.size(a)-1):na,"Last")\nplot(request.security("CHART:TEST","1",close,gaps=barmerge.gaps_on),"Events")\nplot(request.security("CHART:TEST","1",close,gaps=barmerge.gaps_off),"Carry")';
  const last=groups.map(group=>group.at(-1)?.close??null);let carried=null;
  for(const version of [5,6]) {
    const result=await run(body,{version,snapshot});
    assert.deepEqual(values(result,"Count"),groups.map(group=>group.length));
    assert.deepEqual(values(result,"First"),groups.map(group=>group[0]?.close??null));
    assert.deepEqual(values(result,"Last"),last);assert.deepEqual(values(result,"Events"),last);
    carried=null;assert.deepEqual(values(result,"Carry"),last.map(value=>{if(value!==null)carried=value;return carried;}));
    const empty=await run(body,{version,snapshot:[]});
    assert.deepEqual(values(empty,"Count"),chartBars.map(()=>0));
    assert.deepEqual(values(empty,"Last"),chartBars.map(()=>null));assert.deepEqual(values(empty,"Carry"),chartBars.map(()=>null));
  }
});

test("non-divisor lower periods use complete globally available buckets with opening-time membership",async()=>{
  // Pinned native OPEN membership and primary-doc magnifier inference, not a
  // recorded TradingView cross-boundary calibration.
  const targets=complete(minuteBars,2),groups=members(targets);
  const body='a=request.security_lower_tf("CHART:TEST","2",close)\nplot(array.size(a),"Count")\nplot(array.get(a,0),"First")\nplot(array.get(a,array.size(a)-1),"Last")\nplot(request.security("CHART:TEST","2",close,lookahead=barmerge.lookahead_on),"On")\nplot(request.security("CHART:TEST","2",close,lookahead=barmerge.lookahead_off),"Off")';
  for(const version of [5,6]) {
    const result=await run(body,{version});
    assert.deepEqual(values(result,"Count"),groups.map(group=>group.length));
    for(const name of ["First","On"])assert.deepEqual(values(result,name),groups.map(group=>group[0].close));
    for(const name of ["Last","Off"])assert.deepEqual(values(result,name),groups.map(group=>group.at(-1).close));
    const prefix=await run(body,{version,snapshot:minuteBars.slice(0,5),chart:chartBars.slice(0,1)});
    assert.deepEqual(values(prefix,"Count"),[2]);
    const prefixTargets=complete(minuteBars.slice(0,5),2);
    assert.deepEqual(values(prefix,"First"),[prefixTargets[0].close]);assert.deepEqual(values(prefix,"Last"),[prefixTargets.at(-1).close]);
  }
});

test("missing source children omit incomplete derived periods instead of filling them",async()=>{
  const snapshot=minuteBars.filter((_,i)=>i!==3),groups=members(complete(snapshot,2));
  const body='a=request.security_lower_tf("CHART:TEST","2",close)\nplot(array.size(a),"Count")\nplot(array.get(a,0),"First")\nplot(array.get(a,array.size(a)-1),"Last")';
  for(const version of [5,6]) {
    const result=await run(body,{version,snapshot});
    assert.deepEqual(values(result,"Count"),groups.map(group=>group.length));
    assert.deepEqual(values(result,"First"),groups.map(group=>group[0].close));
    assert.deepEqual(values(result,"Last"),groups.map(group=>group.at(-1).close));
  }
});

test("calc_bars_count bounds actual recent remote history and its TA warmup",async()=>{
  const body='a=request.security_lower_tf("CHART:TEST","1",ta.sma(close,2),calc_bars_count=3)\nplot(array.size(a),"Count")\nplot(array.size(a)>0?array.get(a,0):na,"First")\nplot(array.size(a)>0?array.get(a,array.size(a)-1):na,"Last")';
  const moving=sma(closes.slice(-3),2);
  for(const version of [5,6]) {
    const result=await run(body,{version});
    assert.deepEqual(values(result,"Count"),chartBars.map((_,i)=>i===7?3:0));
    assert.deepEqual(values(result,"First"),chartBars.map(()=>null));
    assert.deepEqual(values(result,"Last"),chartBars.map((_,i)=>i===7?moving.at(-1):null));
  }
});

test("named requests and nested UDFs keep actual parameter values in the lower context",async()=>{
  const body='f(float amount)=>request.security(expression=close+amount,timeframe="1",symbol="CHART:TEST")\ng(float amount)=>f(amount+2)\nplot(g(1),"First")\nplot(g(9),"Second")';
  for(const policy of policies) {
    const result=await run(body,policy);
    assert.deepEqual(values(result,"First"),chartBars.map((_,i)=>closes[i*5+4]+3));
    assert.deepEqual(values(result,"Second"),chartBars.map((_,i)=>closes[i*5+4]+11));
  }
});

test("static nested lower requests retain root context while dynamic requests use the intrabar context",async()=>{
  const body='inner=request.security("","",timeframe.period=="5"?5:1)\na=request.security_lower_tf("CHART:TEST","1",inner)\nplot(array.get(a,0),"First")\nplot(array.get(a,4),"Last")';
  for(const version of [5,6]) for(const dynamic of [false,true]) {
    const result=await run(body,{version,dynamic});
    // Static original-context values are available only after each chart close.
    assert.deepEqual(values(result,"First"),chartBars.map((_,i)=>dynamic?1:i===0?null:5));
    assert.deepEqual(values(result,"Last"),chartBars.map(()=>dynamic?1:5));
  }
});

test("nested immutable intrabar arrays transport original static values without reinterpreting them",async()=>{
  const body='inner=request.security_lower_tf("CHART:TEST","1",close)\nplot(request.security("CHART:TEST","15",array.size(inner)),"Count")';
  for(const version of [5,6]) for(const dynamic of [false,true]) {
    const result=await run(body,{version,dynamic});
    assert.deepEqual(values(result,"Count"),chartBars.map((_,i)=>i<2?null:dynamic?15:5));
  }
});

test("foreign identity and modifiers cannot fake lower prices even with ignore options",async()=>{
  for(const expression of [
    'request.security("OTHER:TEST","1",close,ignore_invalid_symbol=true)',
    'request.security_lower_tf("OTHER:TEST","1",close,ignore_invalid_symbol=true)',
    'request.security_lower_tf("TEST","1",close)',
    'request.security(ticker.heikinashi("OTHER:TEST"),"1",close)',
  ])for(const version of [5,6])await requireError('plot('+expression+',"Bad")',{version},"UNAVAILABLE_DATA");
  const good=await run('a=request.security_lower_tf("chart:test","1",close)\nplot(array.size(a),"Count")');
  assert.deepEqual(values(good,"Count"),chartBars.map(()=>5));
});

test("equal-timeframe requests preserve authoritative chart data even with a conflicting equal-TF snapshot",async()=>{
  const alternate=chartBars.map(bar=>({...bar,open:200,high:210,low:190,close:205}));
  const result=await run('plot(close,"Root")\nplot(request.security("","",close),"Same")',{sourceSnapshot:{timeframe:"5",bars:alternate}});
  for(const name of ["Root","Same"])assert.deepEqual(values(result,name),chartBars.map(bar=>bar.close));
  const same=await run('a=request.security_lower_tf("","",close)\nplot(array.size(a),"Count")\nplot(array.get(a,0),"Close")',{sourceSnapshot:null});
  assert.deepEqual(values(same,"Count"),chartBars.map(()=>1));assert.deepEqual(values(same,"Close"),chartBars.map(bar=>bar.close));
  await requireError('plot(request.security("CHART:TEST","1",close),"Unavailable")',{sourceSnapshot:null},"UNAVAILABLE_DATA");
});

test("higher lower_tf timeframe respects its ignore flag without suppressing foreign identity errors",async()=>{
  const body='a=request.security_lower_tf("CHART:TEST","15",close,ignore_invalid_timeframe=true)\nplot(na(a)?1:0,"Ignored")';
  for(const version of [5,6])assert.deepEqual(values(await run(body,{version}),"Ignored"),chartBars.map(()=>1));
  for(const version of [5,6])await requireError(body.replace("CHART:TEST","OTHER:TEST"),{version},"UNAVAILABLE_DATA");
});

test("snapshot boundaries, grids, dense order and shape validation fail before price publication",()=>{
  const snapshots=[
    [{timeframe:"1",bars:minuteBars,symbol:"OTHER:TEST"},"INVALID_CONTEXT"],
    [{timeframe:"1",bars:minuteBars,url:"https://example.invalid"},"INVALID_CONTEXT"],
    [{timeframe:"15",bars:[]},"UNAVAILABLE_DATA"],
    [{timeframe:"1",bars:[minuteBars[1],minuteBars[0]]},"INVALID_BARS"],
    [{timeframe:"1",bars:[minuteBars[0],minuteBars[0]]},"INVALID_BARS"],
    [{timeframe:"1",bars:[{...minuteBars[0],time:start+1}]},"INVALID_BARS"],
    [{timeframe:"1",bars:[{...minuteBars[0],time:start-60}]},"INVALID_BARS"],
    [{timeframe:"1",bars:[{...minuteBars.at(-1),time:start+40*60}]},"INVALID_BARS"],
    [{timeframe:"1",bars:[{...minuteBars[0],high:0}]},"INVALID_BARS"],
    [{timeframe:"1",bars:new Array(2)},"INVALID_BARS"],
    [{timeframe:"1",bars:new Array(200001).fill(minuteBars[0])},"BAR_LIMIT"],
  ];
  assert.deepEqual(pine.validatePineRequest(protocolRequest({timeframe:"1S",bars:[]})).sourceSnapshot,{timeframe:"1S",bars:[]});
  for(const [snapshot,code]of snapshots)assert.throws(()=>pine.validatePineRequest(protocolRequest(snapshot)),error=>{assert.equal(error.code,code,error.message);return true;});
  assert.deepEqual(pine.validatePineRequest(protocolRequest({timeframe:"1",bars:minuteBars},{mode:"live"})).sourceSnapshot.bars.map(bar=>bar.time),minuteBars.map(bar=>bar.time));
});

test("owned source validation freezes copies without invoking source accessors or inherited metadata",()=>{
  const input={timeframe:"1",bars:minuteBars.map(bar=>({...bar}))};
  const parsed=pine.validatePineRequest(protocolRequest(input));
  assert.notEqual(parsed.sourceSnapshot,input);assert.notEqual(parsed.sourceSnapshot.bars,input.bars);
  input.bars[0].close=999;
  assert.equal(parsed.sourceSnapshot.bars[0].close,closes[0]);
  assert.ok(Object.isFrozen(parsed.sourceSnapshot));assert.ok(Object.isFrozen(parsed.sourceSnapshot.bars));assert.ok(Object.isFrozen(parsed.sourceSnapshot.bars[0]));
  let accesses=0;const evil={timeframe:"1"};
  Object.defineProperty(evil,"bars",{enumerable:true,get(){accesses++;return minuteBars;}});
  assert.throws(()=>pine.validatePineRequest(protocolRequest(evil)),error=>error.code==="INVALID_BARS");assert.equal(accesses,0);
  assert.throws(()=>pine.validatePineRequest(protocolRequest(Object.create({timeframe:"1",bars:minuteBars}))),error=>error.code==="INVALID_MESSAGE");
});

test("the real chart snapshot helper clips owned history and preserves an unfinished replay prefix",()=>{
  const boundedChart=chartBars.slice(1,3),prefix=minuteBars.slice(0,13);
  for(const [sourceTF,chartTF]of [["1m","5m"],["M1","M5"],["1","5"]]) {
    const result=pine.pineSourceSnapshotForChart(prefix,sourceTF,boundedChart,chartTF);
    assert.equal(result.timeframe,"1");assert.deepEqual(result.bars.map(bar=>bar.time),minuteBars.slice(5,13).map(bar=>bar.time));
    assert.equal(result.bars.length,8);
  }
  assert.equal(pine.pineSourceSnapshotForChart(minuteBars,"5m",chartBars,"5m"),undefined);
  assert.equal(pine.pineSourceSnapshotForChart(minuteBars,undefined,chartBars,"5m"),undefined);
  assert.equal(pine.pineSourceSnapshotForChart(minuteBars,"1m",[],"5m"),undefined);
  const gap=minuteBars.filter((_,i)=>i!==7);
  assert.deepEqual(pine.pineSourceSnapshotForChart(gap,"1m",chartBars,"5m").bars.map(bar=>bar.time),gap.map(bar=>bar.time));
});

test("runtime ownership rejects a different source behind identical aggregated chart bars",()=>{
  const owner={bars:chartBars,sourceBars:minuteBars,sourceTimeframe:"1m",indicators:[],mode:"historical",symbol:"CHART:TEST",timeframe:"5m",contextKey:"test"};
  assert.ok(pine.chartRuntimeOwnerMatches(owner,{...owner}));
  assert.equal(pine.chartRuntimeOwnerMatches(owner,{...owner,sourceBars:[...minuteBars]}),false);
  assert.equal(pine.chartRuntimeOwnerMatches(owner,{...owner,sourceTimeframe:"5m"}),false);
});

test("lower requested strategy quantities produce exact fills at primary chart prices",async()=>{
  const body='a=request.security_lower_tf("CHART:TEST","1",close)\nqty=math.floor(array.get(a,0)/20)\nif bar_index==1\n    strategy.entry("Lower",strategy.long,qty=qty)\nif bar_index==3\n    strategy.close("Lower")\nplot(qty,"Quantity")';
  for(const version of [5,6]) {
    const declaration='strategy("Lower112 quantity",initial_capital=100000,dynamic_requests=false)',result=await run(body,{version,declaration});
    assert.equal(result.source,"//@version="+version+"\n"+declaration+"\n"+body);
    const trades=result.strategy.closedTrades;assert.equal(trades.length,1);
    assert.equal(trades[0].size,5);assert.equal(trades[0].entry_bar_index,2);assert.equal(trades[0].exit_bar_index,4);
    assert.equal(trades[0].entry_price,111);assert.equal(trades[0].exit_price,102);assert.equal(trades[0].profit,-45);
  }
});


test("all non-chart contexts use authoritative minutes so partial chart aggregates cannot invent complete higher bars",async()=>{
  const body='a=request.security_lower_tf("CHART:TEST","1",close)\nplot(array.size(a),"Intrabars")\nplot(request.security("CHART:TEST","15",close),"Higher")';
  for(const version of [5,6]) {
    const prefix=minuteBars.slice(0,12),partial=await run(body,{version,snapshot:prefix,chart:aggregateFive(prefix)});
    assert.deepEqual(values(partial,"Intrabars"),[5,5,2]);
    assert.deepEqual(values(partial,"Higher"),[null,null,null]);
    const full=minuteBars.slice(0,15),complete=await run(body,{version,snapshot:full,chart:aggregateFive(full)});
    assert.deepEqual(values(complete,"Intrabars"),[5,5,5]);
    assert.deepEqual(values(complete,"Higher"),[null,null,closes[14]]);
  }
});

test("conditional v5 wrapper extraction keeps lower expressions isolated and v6 false rejects local wrapper calls",async()=>{
  const body='f()=>\n    requested=request.security("CHART:TEST","1",ta.cum(close))\n    var int count=0\n    count+=1\n    requested+count\nfloat answer=na\nif bar_index%2==1\n    answer:=f()\nplot(answer,"Answer")';
  // Dynamic requests execute only at called chart bars, so their remote TA
  // history follows the conditional predicate evaluated on minute bar_index (111 contract).
  for(const dynamic of ["default",false,true]) {
    const result=await run(body,{version:5,dynamic});
    let sum=0;
    const expected=chartBars.map((_,i)=>i%2?(sum=closes.slice(0,i*5+5).reduce((a,b,index)=>index%2?a+b:a,0),sum+(i+1)/2):null);
    assert.deepEqual(values(result,"Answer"),dynamic===true?expected:chartBars.map((_,i)=>i%2?cumulative[i*5+4]+(i+1)/2:null));
  }
  const dynamic6=await run(body,{version:6,dynamic:true});
  let sum6=0;
  assert.deepEqual(values(dynamic6,"Answer"),chartBars.map((_,i)=>i%2?(sum6=closes.slice(0,i*5+5).reduce((a,b,index)=>index%2?a+b:a,0),sum6+(i+1)/2):null));
  for(const action of ["prepare","run"])await requireError(body,{version:6,dynamic:false,action},"COMPILE_ERROR");
});

test("many lower array callsites retain the bounded shared request context budget",async()=>{
  const body=Array.from({length:65},(_,i)=>'a'+i+'=request.security_lower_tf("CHART:TEST","1",close+'+i+')').join("\n")+
    '\nplot('+Array.from({length:65},(_,i)=>'array.size(a'+i+')').join("+")+',"Counts")';
  for(const version of [5,6])await requireError(body,{version},"REQUEST_LIMIT");
});


test("cumulative isolated scalar intrabar histories retain a protected shared resource limit",async()=>{
  const fields=Array.from({length:60},(_,i)=>"v"+i);
  const body=fields.map((id,i)=>id+'=request.security_lower_tf("CHART:TEST","1",close+'+i+')').join("\n")+'\nplot('+fields.map(id=>"array.size("+id+")").join("+")+',"Count")';
  const program=[
    'import {build} from "esbuild";',
    'import {createPineEnginePlugin} from '+JSON.stringify(new URL("../../scripts/pine-engine.mjs",import.meta.url).href)+';',
    'Error.stackTraceLimit=0;',
    'const bundle=(await build({bundle:true,minify:true,format:"esm",platform:"browser",target:"es2020",write:false,logLevel:"silent",plugins:[createPineEnginePlugin()],stdin:{contents:\'export * from "./frontend/src/workers/pineNative.worker.ts";\',resolveDir:'+JSON.stringify(root)+',sourcefile:"pine-lower-timeframe112-quota.ts",loader:"ts"}})).outputFiles[0].text;',
    'const pine=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));',
    'const start='+start+';',
    'const minutes=Array.from({length:5000},(_,i)=>({time:start+i*60,open:80,close:80+i%37,high:82+i%37,low:79,volume:100}));',
    'const chart=Array.from({length:1000},(_,i)=>{const group=minutes.slice(i*5,i*5+5);return {time:group[0].time,open:80,high:Math.max(...group.map(b=>b.high)),low:79,close:group[4].close,volume:500};});',
    'try {await pine.executePineRequest({id:"lower112-quota",action:"run",source:'+JSON.stringify(original(body))+',inputs:{},mode:"historical",context:'+JSON.stringify(context)+',bars:chart,sourceSnapshot:{timeframe:"1",bars:minutes}});process.stdout.write(JSON.stringify({ok:true}));}',
    'catch(error){process.stdout.write(JSON.stringify({ok:false,code:error.code,message:String(error.message).slice(0,4096)}));}',
  ].join("\n");
  let child;
  try { child=await promisify(execFile)(process.execPath,["--max-old-space-size=768","--input-type=module","-e",program],{cwd:root,timeout:25000,maxBuffer:16384}); } catch(error) { assert.fail("Protected lower-request resource probe failed: "+JSON.stringify({code:error.code,signal:error.signal,killed:error.killed,stderr:String(error.stderr).slice(0,700)})); }
  const {stdout,stderr}=child;
  assert.equal(stderr,"");
  const result=JSON.parse(stdout);
  assert.equal(result.ok,false,"60 isolated 5,000-minute scalar histories exceed the shared retained-series and intrabar budget");
  assert.equal(result.code,"REQUEST_LIMIT",result.message);
  assert.match(result.message,/history|series|intrabar|point|requested/i);
});

test("shared mutable dependencies retain explicit host isolation refusal when frozen into another request",async()=>{
  const body='var array<float> shared=array.new<float>(1,0.0)\narray.set(shared,0,array.get(shared,0)+close)\nf()=>request.security_lower_tf("CHART:TEST","1",array.get(shared,0))\ninner=f()\nplot(request.security("CHART:TEST","15",array.sum(inner)),"Outer")';
  for(const version of [5,6])await requireError(body,{version,dynamic:false},"UNSUPPORTED_REQUEST_EXPRESSION");
});


test("provided raw non-day-divisor timeframes do not break ordinary or lower-requested chart values",async()=>{
  const start7=Math.floor(start/420)*420;
  const raw=minuteBars.slice(0,28).map((bar,i)=>({...bar,time:start7+i*60}));
  const chart=Array.from({length:4},(_,i)=>{const group=raw.slice(i*7,i*7+7);return {time:group[0].time,open:group[0].open,high:Math.max(...group.map(bar=>bar.high)),low:Math.min(...group.map(bar=>bar.low)),close:group[6].close,volume:group.reduce((sum,bar)=>sum+bar.volume,0)};});
  const body='plot(close,"Root")\na=request.security_lower_tf("CHART:TEST","1",close)\nplot(array.size(a),"Count")\nplot(request.security("CHART:TEST","1",close),"Last")';
  for(const version of [5,6]) {
    const result=await run(body,{version,snapshot:raw,chart,ctx:{...context,timeframe:"7"}});
    assert.deepEqual(values(result,"Root"),chart.map(bar=>bar.close));assert.deepEqual(values(result,"Count"),chart.map(()=>7));
    assert.deepEqual(values(result,"Last"),chart.map(bar=>bar.close));
  }
  assert.equal(pine.pineSourceSnapshotForChart(raw,"1m",chart,"7m").bars.length,28);
  const start22=Math.floor(start/1320)*1320;
  const eleven=minuteBars.slice(0,16).map((bar,i)=>({...bar,time:start22+i*660}));
  const twentyTwo=Array.from({length:8},(_,i)=>{const a=eleven[i*2],b=eleven[i*2+1];return {time:a.time,open:a.open,high:Math.max(a.high,b.high),low:Math.min(a.low,b.low),close:b.close,volume:a.volume+b.volume};});
  const rawBody='a=request.security_lower_tf("CHART:TEST","11",close)\nplot(array.size(a),"Count")\nplot(array.get(a,0),"First")\nplot(request.security("CHART:TEST","11",close),"Last")';
  const result=await run(rawBody,{chart:twentyTwo,ctx:{...context,timeframe:"22"},sourceSnapshot:{timeframe:"11",bars:eleven}});
  assert.deepEqual(values(result,"Count"),twentyTwo.map(()=>2));assert.deepEqual(values(result,"First"),twentyTwo.map((_,i)=>eleven[i*2].close));
  assert.deepEqual(values(result,"Last"),twentyTwo.map(bar=>bar.close));
});

test("snapshot helper retains only the latest owned 200000 source candles within the chart window",()=>{
  const source=Array.from({length:200001},(_,i)=>({...minuteBars[0],time:start+i*60}));
  const chart=Array.from({length:20000},(_,i)=>({...chartBars[0],time:start+i*900}));
  const result=pine.pineSourceSnapshotForChart(source,"M1",chart,"15m");
  assert.equal(result.bars.length,200000);assert.equal(result.bars[0].time,start+60);assert.equal(result.bars.at(-1).time,start+200000*60);
});

test("tuple SMA/time and unrelated lower-array plot reads do not rebind a later independent sibling request",async()=>{
  const body='length=input.int(2,"Length",minval=1,maxval=10)\nf()=>[close,ta.sma(close,length),time]\n[c,m,t]=request.security_lower_tf("CHART:TEST","1",f())\nplot(close*2,"Root doubled")\nplot(array.size(c),"Count")\nplot(array.get(c,0),"First")\nplot(array.get(c,4),"Last")\nplot(array.get(m,4),"SMA")\nplot(array.get(t,0),"Time")\nplot(request.security("CHART:TEST","1",close,lookahead=barmerge.lookahead_on),"On")';
  for(const policy of policies) {
    const prepared=await run(body,{...policy,action:"prepare"});
    assert.deepEqual(prepared.inputDefinitions.map(item=>[item.id,item.defval]),[["in_0",2]]);
    for(const length of [2,3]) {
      const inputs=JSON.parse(JSON.stringify({in_0:length})),result=await run(body,{...policy,inputs}),moving=sma(closes,length);
      assert.equal(result.source,original(body,policy.version,policy.dynamic));assert.deepEqual(result.inputs,inputs);
      assert.deepEqual(values(result,"Root doubled"),chartBars.map(bar=>bar.close*2));
      assert.deepEqual(values(result,"Count"),chartBars.map(()=>5));
      assert.deepEqual(values(result,"First"),chartBars.map((_,i)=>closes[i*5]));
      assert.deepEqual(values(result,"Last"),chartBars.map((_,i)=>closes[i*5+4]));
      assertNumbers(values(result,"SMA"),chartBars.map((_,i)=>moving[i*5+4]));
      assert.deepEqual(values(result,"Time"),chartBars.map(bar=>bar.time*1000));
      assert.deepEqual(values(result,"On"),chartBars.map((_,i)=>closes[i*5]));
    }
  }
});

test("unsafe unrelated request consumers fail explicitly before projection rather than changing shared state",async()=>{
  // These are valid Pine effects outside the isolated expression. The host
  // refuses them when it cannot safely project an independent request slice.
  const bodies=[
    'a=request.security_lower_tf("CHART:TEST","1",close)\nvar shared=array.new<float>()\narray.push(shared,array.get(a,4))\nplot(request.security("CHART:TEST","1",close))',
    'consume(array<float> items)=>\n    array.push(items,0)\n    array.get(items,4)\na=request.security_lower_tf("CHART:TEST","1",close)\nconsume(a)\nplot(request.security("CHART:TEST","1",close))',
    'type Cell\n    float price=0\nvar Cell shared=Cell.new()\nmutate(array<float> items)=>\n    Cell alias=shared\n    alias.price:=array.get(items,4)\n    alias.price\na=request.security_lower_tf("CHART:TEST","1",close)\nseen=mutate(a)\nplot(request.security("CHART:TEST","1",shared.price))',
  ];
  for(const body of bodies)for(const policy of policies)for(const action of ["prepare","run"])
    await assert.rejects(run(body,{...policy,action}),error=>{
      assert.equal(error.code,"COMPILE_ERROR",error.message);
      assert.match(error.message,/Unrelated request consumers with shared state cannot be isolated safely\./);
      return true;
    });
});
