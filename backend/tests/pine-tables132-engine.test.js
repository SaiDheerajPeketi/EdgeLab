import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createPineEnginePlugin } from '../../scripts/pine-engine.mjs';

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent', plugins: [createPineEnginePlugin()], stdin: { contents: 'export { PineTS, Indicator, Context } from "pinets";', resolveDir: new URL('../../', import.meta.url).pathname, loader: 'ts' } })).outputFiles[0].text;
console.info('PINE_TABLES132_ENGINE_BINDING ' + JSON.stringify({ minify: true, bundleSha256: createHash('sha256').update(bundle).digest('hex'), manifestSha256: createHash('sha256').update(fs.readFileSync(new URL('../../frontend/vendor/pinets/manifest.json', import.meta.url))).digest('hex') }));
const { PineTS, Indicator, Context } = await import('data:text/javascript;base64,' + Buffer.from(bundle).toString('base64'));
const candle = (index, close = 100, confirmed = true) => ({ openTime: 1700000040000 + index * 60000, closeTime: confirmed ? 1700000100000 + index * 60000 : Date.now() + 3600000, open: close, high: close + 2, low: close - 2, close, volume: 10 });
const bars = Array.from({ length: 4 }, (_, i) => candle(i));
const source = (body, version = 6) => '//@version=' + version + '\nindicator("Tables 132", overlay=false)\n' + body;
const run = (body, version = 6) => new PineTS(bars, 'TEST', '1', bars.length).run(new Indicator(source(body, version)));
const tables = context => context.plots.__tables__.data.at(-1).value;
const direct = () => { const context = new Context({ marketData: bars, source: bars }); return { context, api: context.pine.table }; };

async function live(body, version = 6) {
  let snapshot = bars.slice(0, 3).map(bar => ({ ...bar }));
  const provider = { configure() {}, async getMarketData(_s, _t, limit, start, end) { let result = snapshot.filter(bar => (start === undefined || bar.openTime >= start) && (end === undefined || bar.openTime <= end)); if (limit !== undefined) result = result.slice(-limit); return result.map(bar => ({ ...bar })); }, async getSymbolInfo() { return { tickerid: 'TEST', ticker: 'TEST', timezone: 'UTC', session: '24x7', currency: 'USD', mintick: .01, pricescale: 100, minmove: 1, pointvalue: 1 }; } };
  const engine = new PineTS(provider, 'TEST', '1', snapshot.length);
  engine.setRealtimeMode(true, { initialTail: 'historical' });
  const context = await engine.run(new Indicator(source(body, version)));
  return { engine, context, async tick(close, confirmed = false) { if (snapshot.at(-1).closeTime <= Date.now()) snapshot.push(candle(snapshot.length, close, confirmed)); else snapshot[snapshot.length - 1] = candle(snapshot.length - 1, close, confirmed); assert.equal(await engine.updateTail(context, { confirmed, received: true }), true); } };
}

test('native v5/v6 constructors retain mixed positional/named base fields, fractional int dimensions and final cells', async () => {
  for (const version of [5, 6]) {
    const context = await run('var table t=table.new(position.top_right,2,2,#010203,#040506,2,#070809,3,force_overlay=true)\nif barstate.islast\n    table.cell(t,0,0,"first\\nsecond",text_color=#ffffff,tooltip="tip",width=25,height=10,text_size=0)\n    t.cell_set_text(0,0,"final\\tvalue")', version);
    const t = tables(context)[0];
    assert.deepEqual([t.position,t.columns,t.rows,t.bgcolor,t.frame_color,t.frame_width,t.border_color,t.border_width,t.force_overlay], ['top_right',2,2,'#010203','#040506',2,'#070809',3,true]);
    assert.equal(t.cells[0][0].text, 'final\tvalue'); assert.equal(t.cells[0][0].populated, true); assert.equal(t.cells[0][0].text_size, 0); assert.equal(t.cells[0][1], null);
    const fractional = tables(await run('var table t=table.new(position.top_left,5 / 2,1)\nif barstate.islast\n    t.cell(3 / 2,0,"fraction")', version))[0];
    assert.equal(fractional.columns, 2); assert.equal(fractional.cells[0][1].text, 'fraction');
  }
});

test('actual Context exposes nine positions, bounded cells, invalid dimensions and percent/stroke/text limits before mutation', () => {
  const { api } = direct();
  for (const position of ['top_left','top_center','top_right','middle_left','middle_center','middle_right','bottom_left','bottom_center','bottom_right']) api.new(position,1,1);
  assert.equal(api.all.array.length, 9);
  for (const dimension of [0,-1,NaN,Infinity,-Infinity,4097,'2']) assert.throws(() => api.new('top_right',dimension,1), /table|dimension|cell/i);
  assert.throws(() => api.new('unsupported',1,1), /position/i);
  const { api: capacity } = direct(); const full=capacity.new('top_right',64,64); assert.equal(full.cells.length,64); assert.throws(() => capacity.new('top_left',1,1), /4096/);
  assert.equal(capacity.new('top_right',64,64).columns,64,'same-position replacement frees active capacity');
  const { api: controls } = direct(); const t=controls.new('top_right',1,1);
  for (const value of [-1,1000001,Infinity,NaN]) { assert.throws(()=>controls.cell(t,0,0,'x',{width:value}),/width/i); assert.throws(()=>controls.cell_set_height(t,0,0,value),/height/i); }
  for (const value of [-1,17,1.5,Infinity]) assert.throws(()=>controls.set_frame_width(t,value),/frame/i);
  assert.throws(()=>controls.cell_set_text(t,0,0,'x'.repeat(4097)),/4096/);
  assert.throws(()=>controls.cell_set_tooltip(t,0,0,'x'.repeat(4097)),/4096/);
  assert.throws(()=>controls.cell_set_text_size(t,0,0,513),/size/i);
});

test('genuine Pine accepts explicit cell percentages beyond the pane while rejecting only the disclosed finite safety bound', async () => {
  for (const version of [5,6]) {
    const t=tables(await run('var table t=table.new(position.top_right,1,1)\nif barstate.islast\n    table.cell(t,0,0,"overflow",width=125,height=125)',version))[0];
    assert.equal(t.cells[0][0].width,125); assert.equal(t.cells[0][0].height,125);
  }
  const {api}=direct(),t=api.new('top_right',1,1);
  api.cell(t,0,0,'finite',{width:1000000,height:1000000}); assert.equal(t.cells[0][0].width,1000000);
  assert.throws(()=>api.cell_set_width(t,0,0,1000001),/width/i);
});

test('populated flags distinguish blank display cells from unset or merge-only cells and full cell calls reset properties', () => {
  const {api}=direct(), t=api.new('top_right',3,2);
  api.cell_set_bgcolor(t,0,0,'#ff0000'); assert.equal(t.cells[0][0].populated,false);
  api.cell(t,0,0,'',{text_color:'#ffffff',bgcolor:'#00ff00',tooltip:'old',text_size:20}); assert.equal(t.cells[0][0].populated,true);
  api.cell(t,0,0,'reset'); assert.equal(t.cells[0][0].tooltip,''); assert.equal(t.cells[0][0].bgcolor,''); assert.equal(t.cells[0][0].text_color,'#363a45');
  api.merge_cells(t,1,0,2,0); assert.equal(t.cells[0][2].populated,false);
  api.clear(t,0,0); assert.equal(t.cells[0][0],null);
});

test('merged child writes cannot overwrite the origin before or after clear, and overlap/reversed/outside ranges reject boundedly', () => {
  const {api}=direct(),t=api.new('top_right',3,3);
  api.merge_cells(t,0,0,1,1); api.cell(t,0,0,'origin'); api.cell(t,1,1,'child'); api.cell_set_text(t,1,0,'setter'); assert.equal(t.cells[0][0].text,'origin');
  api.clear(t,0,0,1,1); api.cell(t,1,1,'ignored after clear'); assert.equal(t.cells[0][0],null); api.cell(t,0,0,'restored'); assert.equal(t.cells[0][0].text,'restored');
  for (const range of [[0,0,1,1],[1,1,2,2],[2,0,1,1],[-1,0,1,1],[0,0,4096,4096]]) assert.throws(()=>api.merge_cells(t,...range),/merge|range/i);
  assert.throws(()=>api.clear(t,0,0,4096,4096),/range/i);
  const count=t.merges.length; api.merge_cells(t,2,2,2,2); assert.equal(t.merges.length,count);
  api.merge_cells(t,NaN,0,2,2); assert.equal(t.merges.length,count);
});

test('native table replacement, relocation, delete/all and exported deep snapshots preserve ownership', () => {
  const {api}=direct(),a=api.new('top_left',2,2),b=api.new('top_right',2,2);
  api.cell(a,0,0,'original'); api.merge_cells(a,0,0,1,0);
  const held=a.toPlotData(); held.cells[0][1]._merge_parent[0]=9; held.cells[0][0].text='changed'; held.merges[0].endCol=9;
  assert.equal(a.cells[0][0].text,'original'); assert.deepEqual(a.cells[0][1]._merge_parent,[0,0]); assert.equal(a.merges[0].endCol,1);
  api.set_position(b,'top_left'); assert.equal(a._deleted,true); assert.equal(api.all.array.length,1);
  api.cell_set_text(a,0,0,'stale'); assert.equal(a.cells[0][0].text,'original');
  const c=api.new('top_left',1,1); assert.equal(b._deleted,true); api.delete(c); assert.equal(api.all.array.length,0);
});

test('genuine persistent engine rolls back retained nested cells, merges, base properties and helper membership on conditional first-tick updates', async () => {
  for (const version of [5,6]) for (const action of ['table.cell_set_text(a,0,0,"provisional")\n    table.set_bgcolor(a,#ff0000)', 'table.clear(a,0,0,1,1)', 'table.merge_cells(a,0,0,1,1)', 'table.delete(a)', 'table.new(position.top_right,1,1)', 'table.set_position(a,position.bottom_left)']) {
    const body='var table a=table.new(position.top_right,2,2)\nif barstate.isfirst\n    table.cell(a,0,0,"committed",bgcolor=#00ff00)\nif barstate.isrealtime and close>105\n    '+action;
    const session=await live(body,version),initial=structuredClone(tables(session.context));
    await session.tick(110); const changed=structuredClone(tables(session.context)); assert.notDeepEqual(changed,initial,action);
    await session.tick(95); assert.deepEqual(tables(session.context),initial,action+' must roll back before branch stops executing');
    await session.tick(110,true); const committed=structuredClone(tables(session.context));
    await session.tick(95); assert.deepEqual(tables(session.context),committed,action+' must persist after confirmation');
  }
});

test('helper-only discarded table references restore provisional same-position replacement and deletion via collection roots', async () => {
  const session=await live('if barstate.isfirst\n    table t=table.new(position.top_right,1,1)\n    table.cell(t,0,0,"only helper retains this")\nif barstate.isrealtime and close>105\n    table.new(position.top_right,1,1)'),initial=structuredClone(tables(session.context));
  await session.tick(110); assert.notDeepEqual(tables(session.context),initial); await session.tick(95); assert.deepEqual(tables(session.context),initial);
});


test('sync preserves the pristine empty table channel and allocated empty cleanup snapshots',async()=>{
 const ordinary=await run('plot(close,"Ordinary")');assert.deepEqual(tables(ordinary),[]);
 const {context,api}=direct(),helper=context._drawingHelpers.find(item=>Array.isArray(item._tables));assert.ok(helper);helper.syncToPlot();assert.deepEqual(tables(context),[]);
 const t=api.new('top_right',1,1);helper.syncToPlot();assert.equal(tables(context).length,1);api.delete(t);helper.syncToPlot();assert.deepEqual(tables(context),[]);
});
