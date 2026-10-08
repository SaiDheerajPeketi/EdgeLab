import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import fs from "node:fs";
import {build} from "esbuild";
import {createPineEnginePlugin} from "../../scripts/pine-engine.mjs";
import {context115,start115,minutes115,aggregate115,bars115,bracket115} from "./fixtures/pine-magnifier115.mjs";
Error.stackTraceLimit=0;
const bundle=(await build({bundle:true,minify:true,platform:"browser",format:"esm",write:false,logLevel:"silent",plugins:[createPineEnginePlugin()],define:{"import.meta.env":"{}"},stdin:{contents:'export * from "./frontend/src/workers/pineNative.worker.ts";export * from "./frontend/src/lib/pineChartAdapter.ts";',resolveDir:new URL("../../",import.meta.url).pathname,sourcefile:"pine-strategy-markers118.ts",loader:"ts"}})).outputFiles[0].text;
console.info("STRATEGY_MARKERS118_BINDING "+JSON.stringify({minify:true,sealed:true,bundleSha256:createHash("sha256").update(bundle).digest("hex"),manifestSha256:createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json",import.meta.url))).digest("hex")}));
const pine=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const run=(source,{minutes=minutes115(),bars=bars115,sourceSnapshot={timeframe:"1",bars:minutes}}={})=>pine.executePineRequest({id:"markers118",action:"run",source,bars,context:context115,inputs:{},...(sourceSnapshot===null?{}:{sourceSnapshot})});
const shapes=markers=>markers.map(marker=>[marker.time,marker.position,marker.shape,marker.color]);

test("closed magnifier fills preserve exact child ledger times while both markers attach to the parent candle",async()=>{
 for(const version of [5,6]){
  const result=await run(bracket115({version})),trade=result.strategy.closedTrades[0],ledger=structuredClone(result.strategy);
  assert.deepEqual([trade.entry_time,trade.exit_time,trade.entry_bar_index,trade.exit_bar_index],[start115+300,start115+420,1,1]);
  const markers=pine.adaptPineChartResult(result,bars115).strategyMarkers;
  assert.deepEqual(shapes(markers),[[start115+300,"belowBar","arrowUp","#22c55e"],[start115+300,"aboveBar","arrowDown","#fb7185"]]);
  assert.deepEqual(result.strategy,ledger);assert.match(markers[0].text,/Pine entry L/);assert.match(markers[1].text,/Pine exit L/);
 }
});
test("open magnifier fill at a later minute is visible on its real parent without fabricating an exit",async()=>{
 for(const version of [5,6]){
  const result=await run(bracket115({version}),{minutes:minutes115("high-first")}),trade=result.strategy.openTrades[0],ledger=structuredClone(result.strategy);
  assert.deepEqual([trade.entry_time,trade.entry_bar_index],[start115+420,1]);
  assert.deepEqual(shapes(pine.adaptPineChartResult(result,bars115).strategyMarkers),[[start115+300,"belowBar","arrowUp","#22c55e"]]);
  assert.deepEqual(result.strategy,ledger);
 }
});

const program=(body,version=6)=>"//@version="+version+'\nstrategy("Parent marker ledger",initial_capital=10000,use_bar_magnifier=true)\n'+body;
test("short entry and buy exit attach to the same parent with preserved opposite-side ledger",async()=>{
 for(const version of [5,6]){
  const source=program('if bar_index==0\n    strategy.entry("S",strategy.short,limit=115)\n    strategy.exit("X","S",limit=90)',version);
  const result=await run(source,{minutes:minutes115("high-first")}),trade=result.strategy.closedTrades[0],ledger=structuredClone(result.strategy);
  assert.deepEqual([trade.entry_price,trade.exit_price,trade.size,trade.profit,trade.entry_time,trade.exit_time],[115,90,-1,25,start115+300,start115+420]);
  assert.deepEqual(shapes(pine.adaptPineChartResult(result,bars115).strategyMarkers),[[start115+300,"aboveBar","arrowDown","#fb7185"],[start115+300,"belowBar","arrowUp","#22c55e"]]);
  assert.deepEqual(result.strategy,ledger);
 }
});
test("partial exits retain the open lot and every actual trade leg without changing quantities",async()=>{
 for(const version of [5,6]){
  const result=await run(program('if bar_index==0\n    strategy.entry("L",strategy.long,qty=4)\n    strategy.exit("One","L",limit=110,qty=1)',version));
  assert.deepEqual(result.strategy.closedTrades.map(t=>[t.entry_price,t.exit_price,t.size,t.profit]),[[100,110,1,10]]);
  assert.deepEqual(result.strategy.openTrades.map(t=>[t.entry_price,t.size]),[[100,3]]);
  const ledger=structuredClone(result.strategy),markers=pine.adaptPineChartResult(result,bars115).strategyMarkers;
  assert.equal(markers.length,3);assert.equal(markers.filter(m=>m.shape==="arrowUp").length,2);
  assert.equal(markers.filter(m=>m.shape==="arrowDown").length,1);
  assert.ok(markers.every(m=>m.time===start115+300));assert.deepEqual(result.strategy,ledger);
 }
});
test("a genuine reversal maps the closing long and new short to their distinct retained parent",async()=>{
 const minutes=[...minutes115(),...Array.from({length:5},(_,i)=>({...minutes115()[0],time:start115+(10+i)*60}))],bars=aggregate115(minutes);
 for(const version of [5,6]){
  const result=await run(program('if bar_index==0\n    strategy.entry("L",strategy.long,qty=2)\nif bar_index==1\n    strategy.entry("S",strategy.short,qty=3)',version),{minutes,bars});
  assert.deepEqual(result.strategy.closedTrades.map(t=>[t.size,t.entry_bar_index,t.exit_bar_index]),[[2,1,2]]);
  assert.deepEqual(result.strategy.openTrades.map(t=>[t.size,t.entry_bar_index]),[[-3,2]]);
  assert.deepEqual(shapes(pine.adaptPineChartResult(result,bars).strategyMarkers),[
   [start115+300,"belowBar","arrowUp","#22c55e"],[start115+600,"aboveBar","arrowDown","#fb7185"],[start115+600,"aboveBar","arrowDown","#fb7185"]]);
 }
});
test("sparse parent times use the native index, never a guessed interval or next/last candle duration",async()=>{
 const minutes=minutes115("high-first").map((bar,i)=>({...bar,time:bar.time+(i>=5?600:0)})),bars=aggregate115(minutes);
 const result=await run(bracket115(),{minutes,bars}),ledger=structuredClone(result.strategy);
 assert.deepEqual([result.strategy.openTrades[0].entry_time,result.strategy.openTrades[0].entry_bar_index],[start115+1020,1]);
 assert.deepEqual(shapes(pine.adaptPineChartResult(result,bars).strategyMarkers),[[start115+900,"belowBar","arrowUp","#22c55e"]]);
 const legacy=structuredClone(result);delete legacy.strategy.openTrades[0].entry_bar_index;
 assert.deepEqual(pine.adaptPineChartResult(legacy,bars).strategyMarkers,[]);
 assert.deepEqual(result.strategy,ledger);
});
test("present malformed and out-of-range indexes withhold the leg even when its raw time exactly matches a candle",async()=>{
 const native=await run(bracket115({magnifier:false}),{sourceSnapshot:null});
 for(const value of [-1,2,1.5,NaN,Infinity,null,"1",undefined,Number.MAX_SAFE_INTEGER+1]){
  const result=structuredClone(native);result.strategy.closedTrades[0].entry_bar_index=value;
  const adapted=pine.adaptPineChartResult(result,bars115);
  assert.equal(adapted.strategyMarkers.length,1);assert.match(adapted.strategyMarkers[0].text,/exit/);
  assert.equal(adapted.adapterWarnings.filter(w=>/valid parent bar index/.test(w)).length,1);
 }
 const both=structuredClone(native);both.strategy.closedTrades[0].entry_bar_index=-1;both.strategy.closedTrades[0].exit_bar_index=-1;
 const adapted=pine.adaptPineChartResult(both,bars115);
 assert.deepEqual(adapted.strategyMarkers,[]);assert.equal(adapted.adapterWarnings.filter(w=>/valid parent bar index/.test(w)).length,1);
});
test("indexed markers require the owned chart length, while absent-index legacy seconds and milliseconds stay exact",async()=>{
 const native=await run(bracket115());
 const mismatch=structuredClone(native);mismatch.audit.bars=3;
 const denied=pine.adaptPineChartResult(mismatch,bars115);
 assert.deepEqual(denied.strategyMarkers,[]);assert.equal(denied.adapterWarnings.filter(w=>/owned chart snapshot/.test(w)).length,1);
 for(const multiplier of [1,1000]){
  const legacy=structuredClone(native),trade=legacy.strategy.closedTrades[0];
  delete trade.entry_bar_index;delete trade.exit_bar_index;
  trade.entry_time=bars115[0].time*multiplier;trade.exit_time=bars115[1].time*multiplier;legacy.audit.bars=999;
  assert.deepEqual(shapes(pine.adaptPineChartResult(legacy,bars115).strategyMarkers),[[start115,"belowBar","arrowUp","#22c55e"],[start115+300,"aboveBar","arrowDown","#fb7185"]]);
 }
 const inherited=structuredClone(native),trade=inherited.strategy.closedTrades[0];
 delete trade.exit_bar_index;Object.setPrototypeOf(trade,{exit_bar_index:1});
 assert.equal(pine.adaptPineChartResult(inherited,bars115).strategyMarkers.length,1);
});
test("fallback without lower data retains ordinary exact-open markers and omits absent or nonfinite exit times",async()=>{
 for(const version of [5,6]){
  const result=await run(bracket115({version}),{sourceSnapshot:null}),ledger=structuredClone(result.strategy);
  assert.deepEqual(shapes(pine.adaptPineChartResult(result,bars115).strategyMarkers),[[start115+300,"belowBar","arrowUp","#22c55e"],[start115+300,"aboveBar","arrowDown","#fb7185"]]);
  assert.deepEqual(result.strategy,ledger);
 }
 const result=await run(bracket115());
 for(const value of [undefined,null,NaN,Infinity]){
  const altered=structuredClone(result);altered.strategy.closedTrades[0].exit_time=value;
  assert.equal(pine.adaptPineChartResult(altered,bars115).strategyMarkers.length,1);
 }
});
