import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createPineEnginePlugin } from '../../scripts/pine-engine.mjs';
Error.stackTraceLimit = 0;

const bundle = (await build({ bundle: true, minify: true, platform: 'browser', format: 'esm', write: false,
  logLevel: 'silent', plugins: [createPineEnginePlugin()], define: { 'import.meta.env': '{}' },
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pineLiveProtocol.ts"; export {toPineWireResponse} from "./frontend/src/lib/pinePacked.ts";',
    resolveDir: new URL('../../', import.meta.url).pathname, loader: 'ts' } })).outputFiles[0].text;
console.info('PINE_VIEWPORT140_BINDING ' + createHash('sha256').update(bundle).digest('hex'));
const pine = await import('data:text/javascript;base64,' + Buffer.from(bundle).toString('base64'));
const candle = (i, close = 100 + i, duration = 60) => ({ time: 1_700_000_100 + i * duration,
  open: close, high: close + 2, low: close - 2, close, volume: 10 });
const bars = Array.from({ length: 8 }, (_, i) => candle(i));
const context = { symbol: 'TEST', timeframe: '1', mintick: .01, pointvalue: 1 };
const request = (body, extra = {}) => ({ id: 'viewport140', action: 'run',
  source: '//@version=6\nindicator("Viewport 140",overlay=true)\n' + body, bars, context, ...extra });
const values = (result, name) => result.plots.find(p => p.name === name).points.map(p => p.value);
const viewport = (from, to) => ({ from: bars[from].time, to: bars[to].time });
const boundaryBody = 'plot(chart.left_visible_bar_time,"Left")\nplot(chart.right_visible_bar_time,"Right")\nplot(time >= chart.left_visible_bar_time and time <= chart.right_visible_bar_time ? close : na,"Visible")';

test('genuine v5/v6 worker applies exact visible milliseconds across all bars; omission preserves snapshot and null is Pine na', async () => {
  for (const version of [5, 6]) {
    const req = request(boundaryBody, { viewport: viewport(2, 5) });
    req.source = req.source.replace('version=6', 'version=' + version);
    const r = await pine.executePineRequest(req);
    assert.equal(r.usesVisibleRange, true);
    assert.deepEqual(values(r, 'Left'), bars.map(() => bars[2].time * 1000));
    assert.deepEqual(values(r, 'Right'), bars.map(() => bars[5].time * 1000));
    assert.deepEqual(values(r, 'Visible'), bars.map((bar, i) => i >= 2 && i <= 5 ? bar.close : null));
  }
  const omitted = await pine.executePineRequest(request(boundaryBody));
  assert.deepEqual(values(omitted, 'Left'), bars.map(() => bars[0].time * 1000));
  assert.deepEqual(values(omitted, 'Right'), bars.map(() => bars.at(-1).time * 1000));
  const empty = await pine.executePineRequest(request(boundaryBody, { viewport: null }));
  for (const name of ['Left', 'Right', 'Visible']) assert.deepEqual(values(empty, name), bars.map(() => null));
});

test('AST dependency metadata excludes comments and strings and includes aliases, UDF bodies and direct built-ins', async () => {
  for (const [body, expected] of [
    ['plot(close)', false], ['// chart.left_visible_bar_time\nplot(close)', false],
    ['plot(close,title="chart.left_visible_bar_time")', false],
    ['string s="chart.right_visible_bar_time"\nplot(str.length(s))', false],
    ['left=chart.left_visible_bar_time\nplot(left)', true],
    ['read()=>\n    chart.right_visible_bar_time\nplot(read())', true], [boundaryBody, true],
  ]) {
    const checked = await pine.executePineRequest({ ...request(body), action: 'prepare', bars: undefined, context: undefined });
    assert.equal(checked.usesVisibleRange, expected, body);
    assert.equal((await pine.executePineRequest(request(body))).usesVisibleRange, expected, body);
  }
});

test('strict viewport and result metadata reject invalid fields/accessors without invoking them and retain legacy unknown', async () => {
  for (const invalid of [undefined, [], {from: 1}, {from: -1,to: 1}, {from: 2,to: 1}, {from: .5,to: 1},
    {from: 0,to: Infinity}, {from: 0,to: 253402300800}, {from: 0,to: 1,extra: 1}, Object.assign(Object.create({}), {from:0,to:1})]) {
    assert.throws(() => pine.validatePineViewport(invalid));
  }
  assert.deepEqual(pine.validatePineViewport({from:0,to:0}), {from:0,to:0});
  for (const outer of [true, false]) {
    let reads = 0;
    const req = request(boundaryBody), value = {from: 0,to: 1};
    Object.defineProperty(outer ? req : value, outer ? 'viewport' : 'from', { enumerable:true, get() { reads++; return value; } });
    if (!outer) req.viewport = value;
    assert.throws(() => pine.validatePineRequest(req)); assert.equal(reads, 0);
  }
  const req = request(boundaryBody), native = await pine.executePineRequest(req);
  const response = result => ({id:req.id,status:'completed',result});
  assert.throws(() => pine.validatePineResponse(response({...native,usesVisibleRange:'true'}), req));
  const old = {...native}; delete old.usesVisibleRange;
  assert.equal(Object.hasOwn(pine.validatePineResponse(response(old),req),'usesVisibleRange'),false);
  const owned = {from:0,to:1}, normalized = pine.validatePineRequest({...req,viewport:owned}); owned.from=100;
  assert.deepEqual(normalized.viewport,{from:0,to:1});
});

test('complete reruns rebuild first-bar var tables and strategy decisions from the same source and inputs', async () => {
  const body = 'n=input.int(2,"Multiplier")\nvar int left=chart.left_visible_bar_time\nvar table t=table.new(position.top_left,1,1)\nif barstate.isfirst\n    table.cell(t,0,0,str.tostring(left))\nplot(time>=left ? close*n : na,"Value")';
  const first = await pine.executePineRequest(request(body,{viewport:viewport(1,4),inputs:{in_0:3}}));
  const second = await pine.executePineRequest(request(body,{viewport:viewport(4,6),inputs:{in_0:3}}));
  assert.equal(first.tables[0].cells[0][0].text,String(bars[1].time*1000));
  assert.equal(second.tables[0].cells[0][0].text,String(bars[4].time*1000));
  assert.deepEqual(values(second,'Value'),bars.map((bar,i)=>i>=4?bar.close*3:null));
  const req = request('if time==chart.left_visible_bar_time\n    strategy.entry("L",strategy.long)\nif time==chart.right_visible_bar_time\n    strategy.close("L")');
  req.source=req.source.replace('indicator("Viewport 140",overlay=true)','strategy("Viewport 140",overlay=true)');
  const a=await pine.executePineRequest({...req,viewport:viewport(1,4)}), b=await pine.executePineRequest({...req,viewport:viewport(3,6)});
  assert.equal(a.usesVisibleRange,true);assert.equal(b.usesVisibleRange,true);
  assert.equal(a.strategy.closedTrades.length,1);assert.equal(b.strategy.closedTrades.length,1);
  assert.notDeepEqual(a.strategy.closedTrades,b.strategy.closedTrades);
});

test('owned higher/lower timeframe and static secondary expressions receive the exact original chart viewport', async () => {
  const r=await pine.executePineRequest(request('plot(request.security(syminfo.tickerid,"2",chart.left_visible_bar_time),"Higher")\nplot(request.security(syminfo.tickerid,"1",chart.right_visible_bar_time),"Same")',{viewport:viewport(2,5)}));
  assert.ok(values(r,'Higher').filter(v=>v!==null).length);
  assert.ok(values(r,'Higher').filter(v=>v!==null).every(v=>v===bars[2].time*1000));
  assert.deepEqual(values(r,'Same'),bars.map(()=>bars[5].time*1000));
  const sourceBars=Array.from({length:20},(_,i)=>candle(i));
  const chartBars=Array.from({length:4},(_,i)=>({ ...candle(i,100,300),high:106,low:98,close:104,volume:50 }));
  const body='a=request.security_lower_tf(syminfo.tickerid,"1",chart.left_visible_bar_time)\nplot(array.size(a)>0 ? array.get(a,0) : na,"Lower")';
  const lower=await pine.executePineRequest(request(body,{bars:chartBars,context:{...context,timeframe:'5'},sourceSnapshot:{timeframe:'1',bars:sourceBars},viewport:{from:chartBars[1].time,to:chartBars[2].time}}));
  assert.deepEqual(values(lower,'Lower'),chartBars.map(()=>chartBars[1].time*1000));
});

function live(body, history=bars.slice(0,3), initialViewport=viewport(0,2)) {
  const executor=pine.createPineLiveExecutor(),sessionId='viewport140-live-session';
  const req=request(body,{id:sessionId+':0',mode:'live',bars:history,viewport:initialViewport});
  const send=(sequence,action,extra={})=>executor.execute({protocol:'pine-live-v1',sessionId,sequence,action,...extra});
  return {executor,send,req,start:()=>send(0,'start',{request:req})};
}

test('live open tail viewport rerun resets historical state, keeps tail open and permits identical tick, close and next bar', async () => {
  const body='var int count=0\nvarip int ticks=0\nif time>=chart.left_visible_bar_time\n    count+=1\nticks+=1\nplot(count,"Count")\nplot(ticks,"Ticks")\nplot(barstate.isrealtime,"Realtime")\nplot(barstate.isconfirmed,"Confirmed")\nplot(chart.left_visible_bar_time,"Left")';
  const s=live(body);await s.start();
  await s.send(1,'update',{bar:candle(3,120),confirmed:false});
  const tick=await s.send(2,'update',{bar:candle(3,121),confirmed:false});assert.equal(values(tick,'Ticks').at(-1),5);
  const r=await s.send(3,'viewport',{viewport:viewport(2,3)});
  assert.deepEqual(values(r,'Count'),[0,0,1,2]);assert.equal(values(r,'Ticks').at(-1),4);
  assert.equal(values(r,'Realtime').at(-1),true);assert.equal(values(r,'Confirmed').at(-1),false);assert.equal(r.audit.bars,4);
  const same=await s.send(4,'update',{bar:candle(3,121),confirmed:false});assert.equal(values(same,'Ticks').at(-1),5);assert.deepEqual(values(same,'Count'),[0,0,1,2]);
  const close=await s.send(5,'update',{bar:candle(3,122),confirmed:true});assert.equal(values(close,'Confirmed').at(-1),true);
  const confirmedReload=await s.send(6,'viewport',{viewport:viewport(1,3)});assert.deepEqual(values(confirmedReload,'Realtime'),[false,false,false,false]);
  const next=await s.send(7,'update',{bar:candle(4,130),confirmed:false});assert.equal(next.audit.bars,5);assert.equal(values(next,'Count').at(-1),4);assert.equal(values(next,'Left').at(-1),bars[1].time*1000);
  s.executor.dispose();await assert.rejects(s.send(8,'viewport',{viewport:null}),e=>e.code==='LIVE_SESSION_HALTED');
});

test('ordinary live sessions do not reset varip on viewport commands, and ordered commands preserve strict sequence guards',async()=>{
  const s=live('varip int ticks=0\nticks+=1\nplot(ticks,"Ticks")');await s.start();
  await s.send(1,'update',{bar:candle(3),confirmed:false});
  const view=await s.send(2,'viewport',{viewport:null});assert.equal(view.usesVisibleRange,false);assert.equal(values(view,'Ticks').at(-1),4);
  const next=await s.send(3,'update',{bar:candle(3),confirmed:false});assert.equal(values(next,'Ticks').at(-1),5);
  await assert.rejects(s.send(5,'viewport',{viewport:viewport(1,2)}),e=>e.code==='LIVE_SEQUENCE');
  await assert.rejects(s.send(4,'update',{bar:candle(3),confirmed:false}),e=>e.code==='LIVE_SESSION_HALTED');
});

test('viewport live command/result ownership uses the same bars, immutable inputs and ordered response identity',async()=>{
  const s=live('n=input.int(3,"n")\nplot(time>=chart.left_visible_bar_time ? close*n : na,"Value")');s.req.inputs={in_0:4};await s.start();
  const command={protocol:'pine-live-v1',sessionId:'viewport140-live-session',sequence:1,action:'viewport',viewport:viewport(1,2)};
  const r=await s.executor.execute(command),expected={...s.req,id:'viewport140-live-session:1',viewport:command.viewport};
  const wire={protocol:command.protocol,sessionId:command.sessionId,sequence:1,response:pine.toPineWireResponse(expected.id,r,expected.bars)};
  assert.equal(pine.validatePineLiveResponse(wire,command,expected).inputs.in_0,4);assert.deepEqual(values(r,'Value'),[null,bars[1].close*4,bars[2].close*4]);
  assert.throws(()=>pine.validatePineLiveResponse({...wire,sequence:2},command,expected));
  s.executor.dispose();
});


test('live viewport creates fresh drawing rollback membership while subsequent conditional deletion restores the new seed', async () => {
  const body='var table t=table.new(position.top_left,1,1)\nif barstate.isfirst\n    table.cell(t,0,0,str.tostring(chart.left_visible_bar_time))\nif barstate.isrealtime and close>110\n    table.delete(t)';
  const s=live(body);await s.start();
  await s.send(1,'update',{bar:candle(3,120),confirmed:false});
  const reloaded=await s.send(2,'viewport',{viewport:viewport(1,3)});assert.deepEqual(reloaded.tables,[]);
  const restored=await s.send(3,'update',{bar:candle(3,100),confirmed:false});
  assert.equal(restored.tables.length,1);assert.equal(restored.tables[0].cells[0][0].text,String(bars[1].time*1000));
  const held=structuredClone(restored.tables);
  await s.send(4,'update',{bar:candle(3,120),confirmed:false});
  const again=await s.send(5,'update',{bar:candle(3,100),confirmed:false});assert.deepEqual(again.tables,held);
  s.executor.dispose();
});

test('worker never executes concurrent or out-of-owner viewport commands and disposes pending execution', async () => {
  const s=live(boundaryBody);await s.start();
  const pending=s.send(1,'viewport',{viewport:viewport(1,2)});
  await assert.rejects(s.send(2,'viewport',{viewport:null}),e=>e.code==='LIVE_CONCURRENT');
  await assert.rejects(pending,e=>e.code==='LIVE_SESSION_HALTED');
  const other=live(boundaryBody);await other.start();
  await assert.rejects(other.executor.execute({protocol:'pine-live-v1',sessionId:'viewport140-other-owner',sequence:1,action:'viewport',viewport:null}),e=>e.code==='LIVE_SESSION_MISMATCH');
  await assert.rejects(other.send(1,'viewport',{viewport:null}),e=>e.code==='LIVE_SESSION_HALTED');
});

test('an intentional empty-viewport runtime error can be prepared without running the body and rerun with exact inputs after visibility returns', async () => {
  const body='n=input.int(2,"Multiplier")\nif na(chart.left_visible_bar_time)\n    runtime.error("No visible candles")\nplot(time>=chart.left_visible_bar_time and time<=chart.right_visible_bar_time ? close*n : na,"Visible")';
  const req=request(body,{viewport:null,inputs:{in_0:4}});
  await assert.rejects(pine.executePineRequest(req),e=>e.code==='RUNTIME_ERROR'&&e.message==='No visible candles');
  const prepared=await pine.executePineRequest({id:req.id,action:'prepare',source:req.source});
  assert.equal(prepared.usesVisibleRange,true);
  const recovered=await pine.executePineRequest({...req,viewport:viewport(2,4)});
  assert.equal(recovered.inputs.in_0,4);
  assert.deepEqual(values(recovered,'Visible'),bars.map((bar,i)=>i>=2&&i<=4?bar.close*4:null));
});
