import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import fs from "node:fs";
import {build} from "esbuild";
import {createPineEnginePlugin} from "../../scripts/pine-engine.mjs";
import {context115,start115,minutes115,aggregate115,bars115,bracket115} from "./fixtures/pine-magnifier115.mjs";

Error.stackTraceLimit=0;
const root=new URL("../../",import.meta.url).pathname;
const bundle=(await build({bundle:true,minify:true,format:"esm",platform:"browser",target:"es2020",write:false,logLevel:"silent",plugins:[createPineEnginePlugin()],define:{"import.meta.env":"{}"},stdin:{contents:'export * from "./frontend/src/workers/pineNative.worker.ts"; export {validatePineRequest,PINE_LIMITS} from "./frontend/src/lib/pineProtocol.ts";',resolveDir:root,sourcefile:"pine-bar-magnifier115.ts",loader:"ts"}})).outputFiles[0].text;
console.info("MAGNIFIER115_BINDING "+JSON.stringify({minify:true,sealed:true,bundleSha256:createHash("sha256").update(bundle).digest("hex"),manifestSha256:createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json",import.meta.url))).digest("hex")}));
const pine=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const run=(source,{minutes=minutes115(),bars=bars115,inputs={},sourceSnapshot={timeframe:"1",bars:minutes},action="run",strategySettings}={})=>pine.executePineRequest({id:"magnifier115",action,source,inputs,...(strategySettings===undefined?{}:{strategySettings}),...(action==="run"?{bars,context:context115,...(sourceSnapshot===null?{}:{sourceSnapshot})}:{})});
const values=(result,name)=>result.plots.find(plot=>plot.name===name).points.map(point=>point.value);
const ledger=result=>result.strategy.closedTrades.map(trade=>[trade.entry_price,trade.exit_price,trade.size,trade.profit]);

// Primary contract: https://www.tradingview.com/pine-script-docs/concepts/strategies/
// Historical detail uses genuine lower OHLC; default calculations remain at parent close.
// These are independently constructed local numerical oracles, not recorded TV ledgers.
test("complete minute chronology changes fills despite identical parent candles",async()=>{
  assert.deepEqual(aggregate115(minutes115("high-first")),bars115);
  for(const version of [5,6]) {
    const source=bracket115({version}).replace(",calc_on_order_fills=false","");
    const early=await run(source);
    const late=await run(source,{minutes:minutes115("high-first")});
    assert.equal(early.source,source);
    assert.deepEqual(ledger(early),[[90,115,1,25]]);
    assert.deepEqual(ledger(late),[]);
    assert.equal(early.strategy.closedTrades[0].entry_time,start115+300);
    assert.equal(early.strategy.closedTrades[0].exit_time,start115+420);
    assert.equal(late.strategy.openTrades.length,1);
    assert.equal(late.strategy.openTrades[0].entry_price,90);
    assert.equal(late.strategy.openTrades[0].entry_time,start115+420);
    assert.deepEqual(values(early,"Calls"),[0,1]);
    assert.deepEqual(values(late,"Calls"),[0,1]);
    assert.deepEqual(values(early,"Close"),[100,100]);
    assert.deepEqual(values(early,"Previous"),[null,100]);
    assert.deepEqual(values(early,"SMA"),[null,100]);
  }
});

test("after-fill calculations interleave actual minute entry and exit fills",async()=>{
  for(const version of [5,6]) {
    const result=await run(bracket115({version,fill:true}));
    assert.deepEqual(ledger(result),[[90,115,1,25]]);
    assert.deepEqual(values(result,"Calls"),[0,3]);
    assert.deepEqual(values(result,"Position"),[0,0]);
    assert.deepEqual(values(result,"Previous"),[null,100]);
    assert.deepEqual(values(result,"SMA"),[null,100]);
  }
});

test("explicit disabled magnifier preserves the chart-path contract",async()=>{
  for(const version of [5,6]) {
    const source=bracket115({version,magnifier:false});
    const a=await run(source),b=await run(source,{minutes:minutes115("high-first")});
    assert.deepEqual(ledger(a),[[90,115,1,25]]);
    assert.deepEqual(ledger(b),ledger(a));
    assert.deepEqual(values(a,"Calls"),[0,1]);
  }
});


const program=(body,{version=6,fill=false,magnifier=true,options=""}={})=>"//@version="+version+
  '\nstrategy("Owned magnifier",initial_capital=10000,default_qty_value=1,use_bar_magnifier='+magnifier+',calc_on_order_fills='+fill+options+
  ')\nvarip int calls=-1\ncalls+=1\n'+body+'\nplot(calls,"Calls")\nplot(strategy.position_size,"Position")\nplot(close[1],"Previous")\nplot(ta.sma(close,2),"SMA")';
const sourceFor=rows=>[...minutes115().slice(0,5),...rows.map((row,i)=>({time:start115+(i+5)*60,open:row[0],high:row[1],low:row[2],close:row[3],volume:10}))];
const reject=code=>error=>{assert.equal(error.code,code,error.message);return true;};

test("new after-fill exits cannot revisit a preceding child's high",async()=>{
  for(const version of [5,6]) {
    const body='if bar_index==0\n    strategy.entry("L",strategy.long,limit=90)\nif strategy.position_size>0\n    strategy.exit("X","L",limit=115)';
    const result=await run(program(body,{version,fill:true}),{minutes:minutes115("high-first")});
    assert.deepEqual(ledger(result),[]);
    assert.equal(result.strategy.openTrades.length,1);
    assert.equal(result.strategy.openTrades[0].entry_price,90);
    assert.deepEqual(values(result,"Calls"),[0,2]);
    assert.equal(result.strategy.pendingOrders.find(order=>order.id==="X").limit,115);
  }
});

test("child price gaps fill at the next actual open without phantom gap levels",async()=>{
  const minutes=sourceFor([[100,102,98,100],[90,92,88,90],[90,93,89,92],[92,94,90,93],[93,95,91,94]]);
  const bars=aggregate115(minutes);
  for(const version of [5,6])for(const fill of [false,true]) {
    const result=await run(program('if bar_index==0\n    strategy.entry("L",strategy.long,limit=95)',{version,fill}),{minutes,bars});
    assert.deepEqual(ledger(result),[]);
    assert.equal(result.strategy.openTrades.length,1);
    assert.equal(result.strategy.openTrades[0].entry_price,90);
    assert.equal(result.strategy.openTrades[0].entry_time,start115+360);
    assert.deepEqual(values(result,"Calls"),[0,fill?2:1]);
  }
});

test("stop-limit activation respects actual chronological lower-bar paths",async()=>{
  for(const version of [5,6])for(const fill of [false,true]) {
    const source=program('if bar_index==0\n    strategy.entry("L",strategy.long,stop=110,limit=90)',{version,fill});
    const activated=await run(source,{minutes:minutes115("high-first")});
    const late=await run(source);
    assert.equal(activated.strategy.openTrades.length,1);
    assert.equal(activated.strategy.openTrades[0].entry_price,90);
    assert.equal(activated.strategy.openTrades[0].entry_time,start115+420);
    assert.deepEqual(late.strategy.openTrades,[]);
    assert.deepEqual(ledger(late),[]);
    assert.equal(late.strategy.pendingOrders.find(order=>order.id==="L").limit,90);
    assert.deepEqual(values(activated,"Calls"),[0,fill?2:1]);
    assert.deepEqual(values(late,"Calls"),[0,1]);
  }
});

test("armed trailing stops use the next child gap open instead of an interpolated stop",async()=>{
  const minutes=sourceFor([[100,120,99,118],[100,101,80,90],[90,100,89,99],[99,101,98,100],[100,101,99,100]]);
  const bars=aggregate115(minutes);
  const body='if bar_index==0\n    strategy.entry("L",strategy.long)\n    strategy.exit("Trail","L",trail_price=110,trail_offset=5)';
  for(const version of [5,6])for(const fill of [false,true]) {
    const result=await run(program(body,{version,fill}),{minutes,bars});
    assert.deepEqual(ledger(result),[[100,100,1,0]]);
    assert.equal(result.strategy.closedTrades[0].entry_time,start115+300);
    assert.equal(result.strategy.closedTrades[0].exit_time,start115+360);
    assert.deepEqual(values(result,"Calls"),[0,fill?3:1]);
  }
});

test("exit reservations allocate physical lots across lower-bar crossings",async()=>{
  const body='if bar_index==0\n    strategy.entry("L",strategy.long,qty=4)\n    strategy.exit("One","L",limit=110,qty=1)\n    strategy.exit("Rest","L",limit=115,qty=3)';
  for(const version of [5,6])for(const fill of [false,true]) {
    const result=await run(program(body,{version,fill}));
    assert.deepEqual(ledger(result),[[100,110,1,10],[100,115,3,45]]);
    assert.equal(result.strategy.metrics.netprofit,55);
    assert.deepEqual(result.strategy.openTrades,[]);
    assert.deepEqual(result.strategy.pendingOrders,[]);
    assert.deepEqual(values(result,"Calls"),[0,fill?4:1]);
  }
});

test("fill callbacks cancel other orders and replace exits before later child crossings",async()=>{
  const body='if bar_index==0\n    strategy.entry("L",strategy.long)\n    strategy.entry("Canceled",strategy.long,limit=85)\n    strategy.exit("X","L",limit=110)\nif strategy.position_size>0\n    strategy.cancel("Canceled")\n    strategy.exit("X","L",limit=115)';
  for(const version of [5,6]) {
    const result=await run(program(body,{version,fill:true,options:",pyramiding=2"}));
    assert.deepEqual(ledger(result),[[100,115,1,15]]);
    assert.deepEqual(result.strategy.openTrades,[]);
    assert.deepEqual(result.strategy.pendingOrders,[]);
    assert.deepEqual(values(result,"Calls"),[0,3]);
  }
});

test("orders created at parent close cannot consume that parent's completed child paths",async()=>{
  for(const version of [5,6])for(const fill of [false,true]) {
    const result=await run(program('if bar_index==1\n    strategy.entry("Late",strategy.long,limit=85)',{version,fill}));
    assert.deepEqual(ledger(result),[]);
    assert.deepEqual(result.strategy.openTrades,[]);
    assert.equal(result.strategy.pendingOrders.find(order=>order.id==="Late").limit,85);
    assert.deepEqual(values(result,"Calls"),[0,1]);
  }
});

test("uncovered and incomplete source groups use explicit default-path fallback",async()=>{
  for(const version of [5,6])for(const fill of [false,true]) {
    const source=bracket115({version,fill});
    for(const options of [{sourceSnapshot:null},{minutes:[]},{minutes:minutes115("high-first").slice(0,9)},{minutes:minutes115("high-first").filter((_,i)=>i!==7)}]) {
      const result=await run(source,options);
      assert.deepEqual(ledger(result),[[90,115,1,25]]);
      assert.deepEqual(values(result,"Calls"),[0,fill?3:1]);
      assert.ok(result.diagnostics.some(item=>item.code==="BAR_MAGNIFIER_COVERAGE"),"Fallback must be disclosed.");
    }
  }
});

test("complete lower OHLC mismatch refuses magnification while disabled mode stays unchanged",async()=>{
  const minutes=minutes115();
  minutes[7].high=130;
  for(const version of [5,6]) {
    await assert.rejects(run(bracket115({version}),{minutes}),reject("UNAVAILABLE_DATA"));
    const legacy=await run(bracket115({version,magnifier:false}),{minutes});
    assert.deepEqual(ledger(legacy),[[90,115,1,25]]);
  }
});

test("saved native input IDs and explicit trader overrides preserve source and select the broker path",async()=>{
  for(const version of [5,6]) {
    const source=bracket115({version}).replace("//@version="+version+"\n","//@version="+version+'\nenabled=input.bool(false,"Actual children")\n').replace("use_bar_magnifier=true","use_bar_magnifier=enabled");
    const prepared=await run(source,{action:"prepare"});
    assert.deepEqual(prepared.inputDefinitions.map(item=>[item.id,item.defval]),[["in_0",false]]);
    const inputs=JSON.parse(JSON.stringify({in_0:true}));
    const actual=await run(source,{inputs,minutes:minutes115("high-first")});
    assert.equal(actual.source,source);
    assert.deepEqual(actual.inputs,inputs);
    assert.equal(actual.strategy.config.use_bar_magnifier,true);
    assert.deepEqual(ledger(actual),[]);
    const override=JSON.parse(JSON.stringify({use_bar_magnifier:false,calc_on_order_fills:true}));
    const disabled=await run(source,{inputs,minutes:minutes115("high-first"),strategySettings:override});
    assert.equal(disabled.source,source);
    assert.deepEqual(disabled.inputs,inputs);
    assert.equal(disabled.strategy.config.use_bar_magnifier,false);
    assert.equal(disabled.strategy.config.calc_on_order_fills,true);
    assert.deepEqual(ledger(disabled),[[90,115,1,25]]);
    assert.deepEqual(values(disabled,"Calls"),[0,3]);
    assert.deepEqual(override,{use_bar_magnifier:false,calc_on_order_fills:true});
  }
});

test("magnifier and fill recalculation settings accept only actual booleans",async()=>{
  for(const version of [5,6])for(const expression of ["1","na",'"true"']) {
    const source=bracket115({version}).replace("use_bar_magnifier=true","use_bar_magnifier="+expression);
    await assert.rejects(run(source),reject("UNSUPPORTED_EXECUTION_SETTING"));
  }
  for(const key of ["use_bar_magnifier","calc_on_order_fills"])for(const value of [0,1,"true",null]) {
    await assert.rejects(run(bracket115(),{strategySettings:{[key]:value}}),reject("INVALID_STRATEGY_SETTINGS"));
  }
});

test("owned source bounds, order and 200000-source cap validate before running the broker",()=>{
  const request=sourceSnapshot=>({id:"magnifier115-validation",action:"run",source:bracket115(),inputs:{},bars:bars115,context:context115,sourceSnapshot});
  const original={timeframe:"1",bars:minutes115()};
  const safe=pine.validatePineRequest(request(original));
  original.bars[0].close=101;
  assert.equal(safe.sourceSnapshot.bars[0].close,100);
  assert.equal(pine.PINE_LIMITS.sourceBars,200000);
  for(const [sourceSnapshot,code] of [
    [{timeframe:"1",bars:[minutes115()[1],minutes115()[0]]},"INVALID_BARS"],
    [{timeframe:"1",bars:[{...minutes115()[0],time:start115-60}]},"INVALID_BARS"],
    [{timeframe:"1",bars:[{...minutes115()[0],time:start115+600}]},"INVALID_BARS"],
    [{timeframe:"1",bars:Array(200001).fill(minutes115()[0])},"BAR_LIMIT"],
    [{timeframe:"1",bars:minutes115(),symbol:"FOREIGN:TEST"},"INVALID_CONTEXT"],
  ])assert.throws(()=>pine.validatePineRequest(request(sourceSnapshot)),reject(code));
});
