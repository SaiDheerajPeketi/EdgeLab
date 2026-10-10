import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Pure controller/API seams: production LWC and browser gestures are verified separately.
const bundle = (await build({
  entryPoints: ['frontend/src/lib/chartViewportNavigation.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent',
})).outputFiles[0].text;
const viewport = await import('data:text/javascript;base64,' + Buffer.from(bundle).toString('base64'));

function frames() {
  let next = 0;
  const pending = new Map();
  return {
    request(callback) { const id = ++next; pending.set(id, callback); return id; },
    cancel(id) { pending.delete(id); },
    get size() { return pending.size; },
    step() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach(callback => callback());
    },
  };
}

test('same-owner ticks preserve both initialization frames and execute current data once', () => {
  const raf = frames(), controller = viewport.createChartViewportInitializer(raf);
  const owner = {}, applied = [];
  let latest = 1;
  const initialize = () => { applied.push(latest); return true; };
  controller.setOwner(owner, initialize);
  for (let tick = 0; tick < 20; tick++) controller.setOwner(owner, initialize);
  assert.equal(raf.size, 1);
  raf.step();
  latest = 601;
  for (let tick = 0; tick < 20; tick++) controller.setOwner(owner, initialize);
  assert.equal(raf.size, 1);
  raf.step();
  assert.deepEqual(applied, [601]);
  assert.equal(controller.pending, false);
  assert.equal(raf.size, 0);
});

test('empty/hidden history retains pending reset until actual bars and layout are ready', () => {
  const raf = frames(), controller = viewport.createChartViewportInitializer(raf);
  let bars = 0, width = 0, applied = 0;
  controller.setOwner({}, () => { if (!bars || !width) return false; applied++; return true; });
  raf.step(); raf.step();
  assert.equal(controller.pending, true);
  bars = 600;
  controller.retry(); raf.step(); raf.step();
  assert.equal(applied, 0);
  assert.equal(controller.pending, true);
  width = 900;
  controller.retry(); raf.step(); raf.step();
  assert.equal(applied, 1);
  assert.equal(controller.pending, false);
});

test('source/timeframe/seek owner replacement cancels old queued initialization', () => {
  const raf = frames(), controller = viewport.createChartViewportInitializer(raf), applied = [];
  controller.setOwner({}, () => { applied.push('old'); return true; });
  raf.step();
  controller.setOwner({}, () => { applied.push('new'); return true; });
  raf.step(); raf.step();
  assert.deepEqual(applied, ['new']);
});

test('linked/manual adoption and disposal cancel outstanding local reset', () => {
  for (const cancel of ['adopt', 'dispose']) {
    const raf = frames(), controller = viewport.createChartViewportInitializer(raf);
    let applied = 0;
    controller.setOwner({}, () => { applied++; return true; });
    raf.step(); controller[cancel](); raf.step(); raf.step();
    assert.equal(applied, 0);
    assert.equal(controller.pending, false);
    assert.equal(raf.size, 0);
  }
});

test('style recreation restore is retained across same-owner data arrivals', () => {
  const raf = frames(), controller = viewport.createChartViewportInitializer(raf), owner = {}, applied = [];
  const initialize = () => { applied.push('initialize'); return true; };
  controller.setOwner(owner, initialize); raf.step(); raf.step();
  controller.reset(() => { applied.push('restore'); return true; });
  controller.setOwner(owner, initialize); raf.step();
  controller.setOwner(owner, initialize); raf.step();
  assert.deepEqual(applied, ['initialize', 'restore']);
});

test('current reset preserves real spacing and whitespace for short and long histories', () => {
  assert.deepEqual(viewport.recentChartLogicalRange(0, 300), { from: -40, to: 8 });
  assert.deepEqual(viewport.recentChartLogicalRange(10, 600), { from: -42, to: 18 });
  assert.deepEqual(viewport.recentChartLogicalRange(600, 960), { from: 512, to: 608 });
  assert.deepEqual(viewport.recentChartLogicalRange(600, 4000), { from: 428, to: 608 });
  for (const [index, width] of [[NaN, 900], [Infinity, 900], [1, 0], [1, 1], [1, NaN]]) {
    assert.equal(viewport.recentChartLogicalRange(index, width), null);
  }
});

test('timestamp-derived logical anchors account for extra study points and unpainted data', () => {
  const known = new Map([[1000, 42], [1060, 44], [1120, 48]]);
  const scale = {
    timeToCoordinate(time) { return known.has(time) ? known.get(time) * 6 + 3 : null; },
    coordinateToLogical(x) { return (x - 3) / 6; },
  };
  assert.equal(viewport.chartCandleLogical(scale, 1120), 48); // Three candles, index48.
  assert.equal(viewport.chartCandleLogical(scale, 1180), null);
  assert.equal(viewport.chartCandleLogical({ ...scale, coordinateToLogical: () => null }, 1120), null);
});

test('append, late historical prefix, and foreign timeline changes preserve zoom and candle position', () => {
  const original = { from: 448.25, to: 608.25 };
  const appended = viewport.translatedChartLogicalRange(original, 600, 601);
  assert.deepEqual(appended, { from: 449.25, to: 609.25 });
  assert.equal(appended.to - appended.from, original.to - original.from);
  assert.equal(appended.to - 601, original.to - 600);
  assert.deepEqual(viewport.translatedChartLogicalRange(original, 600, 600), original);
  assert.deepEqual(viewport.translatedChartLogicalRange(original, 600, 1200), { from: 1048.25, to: 1208.25 });
  assert.deepEqual(viewport.translatedChartLogicalRange(original, 600, 642), { from: 490.25, to: 650.25 });
  assert.equal(viewport.chartLogicalRangesMatch(original, { from: 448.25001, to: 608.25001 }), true);
  assert.equal(viewport.chartLogicalRangesMatch(original, appended), false);
});

test('following uses pixel padding rather than latest-candle visibility or fixed zoom', () => {
  assert.equal(viewport.chartGapMatches(50.2, 50), true);
  assert.equal(viewport.chartGapMatches(90, 50), false); // Latest candle can still be visible.
  assert.equal(viewport.chartGapMatches(180, 50), false); // Future whitespace is detached.
  assert.equal(viewport.chartGapMatches(50, null), false);
  assert.equal(viewport.chartGapMatches(NaN, 50), false);
});


test('already-current native range requires no event and cannot retain a stale paint expectation', () => {
  let actual = { from: 439, to: 608 }, calls = 0;
  const scale = {
    getVisibleLogicalRange: () => actual,
    setVisibleLogicalRange(range) { calls++; actual = range; },
  };
  const canonical = { ...actual };
  let expected = canonical;
  if (!viewport.requestChartLogicalRange(scale, canonical)) expected = null;
  assert.equal(calls, 0); // Real LWC emits no event for its unchanged range.
  assert.equal(expected, null);
  actual = { from: 530, to: 602 }; // A subsequent public/native manual pan.
  assert.equal(viewport.chartLogicalRangesMatch(actual, canonical), false);
  assert.equal(expected, null); // It must be eligible for navigation adoption.
  assert.equal(viewport.requestChartLogicalRange(scale, { from: 440, to: 609 }), true);
  assert.equal(calls, 1);
  assert.deepEqual(actual, { from: 440, to: 609 });
});
