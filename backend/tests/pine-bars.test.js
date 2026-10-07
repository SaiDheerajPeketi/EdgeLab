import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = buildSync({
  bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent",
  stdin: {
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export { Indicator, PineTS } from "pinets";',
    loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-bars-oracle.ts",
  },
}).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = Array.from({ length: 8 }, (_, index) => ({ time: 1700000040 + index * 60, open: 90, high: 115, low: 85, close: 110, volume: 100 }));
const context = { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const program = (body, declaration = "overlay=false") => `//@version=6\nindicator("OHLC bars",${declaration})\n${body}`;
const native = (body, snapshot = bars, declaration, inputs = {}) => pine.executePineRequest({ id: "ohlc-bars", action: "run", source: program(body, declaration), bars: snapshot, context, inputs });
const normalized = (options) => Object.fromEntries(Object.entries(options).filter(([key, value]) => !key.startsWith("_") && value !== undefined).map(([key, value]) => [key, typeof value === "number" && Number.isNaN(value) ? null : value]));

function fixture(snapshot = bars, { from = 0, width = 140, spacing = 20, horizontalRatio = 1, verticalRatio = horizontalRatio, inverted = false, global = snapshot } = {}) {
  const positions = new Map(global.map((bar, index) => [bar.time, index])), listeners = new Set(), series = [], removed = [], rectangles = [];
  const coordinate = (index) => (index - from) * spacing;
  const scale = {
    timeToCoordinate: time => positions.has(time) ? coordinate(positions.get(time)) : null,
    coordinateToLogical: x => Math.ceil(from + x / spacing), logicalToCoordinate: index => Number.isInteger(index) ? coordinate(index) : 0,
    getVisibleLogicalRange: () => ({ from, to: from + width / spacing }),
    getVisibleRange: () => ({ from: global[Math.max(0, Math.ceil(from))]?.time, to: global[Math.min(global.length - 1, Math.floor(from + width / spacing))]?.time }),
    subscribeVisibleTimeRangeChange: callback => listeners.add(callback), unsubscribeVisibleTimeRangeChange: callback => listeners.delete(callback),
  };
  const chart = {
    timeScale: () => scale, paneSize: () => ({ width, height: 200 }),
    addLineSeries(options) {
      const item = { options: () => options, setData(data) { this.data = data; }, priceToCoordinate: value => inverted ? value : 200 - value,
        attachPrimitive(primitive) { primitive.attached({ chart, series: this, requestUpdate() {} }); }, detachPrimitive(primitive) { primitive.detached(); } };
      series.push(item); return item;
    }, removeSeries: item => removed.push(item),
  };
  const ctx = { fillStyle: "", getTransform: () => ({ a: horizontalRatio, d: verticalRatio }), save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect(x, y, w, h) { rectangles.push({ x, y, w, h, color: this.fillStyle }); } };
  const target = { useMediaCoordinateSpace: callback => callback({ context: ctx, mediaSize: { width, height: 200 } }) };
  return { chart, series, removed, listeners, rectangles, coordinate,
    draw(installed) { rectangles.length = 0; for (const view of installed.primitive.paneViews()) { view.renderer()?.drawBackground?.(target); view.renderer()?.draw(target); } return rectangles; },
    pan(next) { from = next; for (const callback of listeners) callback(); },
    resize(next) { width = next; for (const callback of listeners) callback(); },
  };
}
function install(result, snapshot = bars, options) {
  const adapted = pine.adaptPineChartResult(result, snapshot), f = fixture(snapshot, options), installed = pine.installPineChartPlots(f.chart, adapted.plots);
  return { adapted, f, installed };
}
const contains = (rect, x, y) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
const range = installed => installed.primitive.rangeForVisible()?.priceRange ?? null;

test("native named OHLC bars retain independent engine values, times, options and custom inputs", async () => {
  for (const call of ['plotbar(open+shift,high,low,close,title="Bars",color=bar_index%2==0 ? #ff0000 : #0000ff,show_last=5)', 'plotbar(open+shift,high,low,close,title="Bars",color=#ff0000,editable=true,show_last=5,display=display.all,format=format.price,precision=4,force_overlay=false)']) {
    const body = 'shift=input.int(2,"Shift")\n' + call, input = { in_0: 3 }, source = program(body);
    const raw = await new pine.PineTS(bars.map(bar => ({ ...bar, openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000 })), "TEST", "1", bars.length).run(new pine.Indicator(source, input));
    const result = await native(body, bars, undefined, input), expected = raw.plots.Bars;
    assert.equal(result.source, source); assert.equal(result.inputs.in_0, 3); assert.equal(result.plots[0].style, "bar");
    assert.deepEqual(result.plots[0].options, normalized(expected.options));
    assert.deepEqual(result.plots[0].points, expected.data.map(point => ({ time: point.time / 1000, value: point.value, options: normalized(point.options) })));
    assert.deepEqual(result.plots[0].points[0].value, [93, 115, 85, 110]);
    const { adapted, installed } = install(result);
    assert.equal(adapted.plots.length, 1); assert.equal(adapted.plots[0].visual.style, "bar");
    assert.equal(pine.latestPineChartPoint(adapted.plots[0]).value, 110); installed.dispose();
  }
});

test("twelve positional bar arguments and mixed calls match independent named engine flags without changing upstream prototypes", async () => {
  const named = 'plotbar(80,125,75,120,title="Bars",color=#ff000080,editable=false,show_last=2,display=display.none,format=format.price,precision=4,force_overlay=true)';
  const oracle = await native(named);
  for (const call of ['plotbar(80,125,75,120,"Bars",#ff000080,false,2,display.none,format.price,4,true)', 'plotbar(80,125,75,120,"Bars",#ff000080,editable=false,show_last=2,display=display.none,format=format.price,precision=4,force_overlay=true)']) {
    const result = await native(call);
    assert.deepEqual(result.plots, oracle.plots);
    assert.deepEqual(result.plots[0].options, { color: "#ff000080", editable: false, show_last: 2, display: "none", format: "price", precision: 4, force_overlay: true, style: "bar", overlay: true });
    assert.equal(pine.adaptPineChartResult(result, bars).plots.length, 0);
  }
  // Raw engine continues to exhibit its original positional bug after host runs.
  const raw = await new pine.PineTS(bars.map(bar => ({ ...bar, openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000 })), "TEST", "1", bars.length).run(new pine.Indicator(program('plotbar(80,125,75,120,"Bars",#ff000080,false,2,display.none,format.price,4,true)')));
  assert.equal(raw.plots.Bars.options.show_last, undefined);
  assert.equal(raw.plots.Bars.options.force_overlay, undefined);
});

test("invalid, changing and undocumented OHLC bar options reject instead of silently freezing metadata", async () => {
  for (const option of ['editable=1', 'force_overlay="true"', 'show_last=-1', 'show_last=1.5', 'show_last=bar_index', 'precision=17', 'precision=na', 'format=true', 'display=na', 'offset=2', 'wickcolor=#ff0000']) {
    await assert.rejects(native(`plotbar(80,125,75,120,${option})`), error => error.code === "UNSUPPORTED_BAR_OPTION", option);
  }
  await assert.rejects(native('if bar_index%2==0\n    plotbar(80,125,75,120,color=#ff0000)'), error => error.code === "UNSUPPORTED_BAR_OPTION");
});

test("untitled and duplicate-title OHLC calls stay independent with collision-safe host identities", async () => {
  for (const title of ["", ',title="Same"', ',title="1"']) {
    const result = await native(`plotbar(10,30,0,20,color=#ff0000${title})\nplotbar(40,60,35,50,color=#0000ff${title})`);
    assert.equal(result.plots.length, 2); assert.notEqual(result.plots[0].id, result.plots[1].id);
    for (const values of [[10,30,0,20], [40,60,35,50]]) {
      const plot = result.plots.find(plot => JSON.stringify(plot.points[0].value) === JSON.stringify(values));
      assert.ok(plot); assert.equal(plot.points.length, bars.length);
      assert.deepEqual(plot.points.map(point => point.time), bars.map(bar => bar.time));
    }
    if (title) assert.ok(result.plots.every(plot => plot.name === (title.includes('"1"') ? "1" : "Same")));
    else assert.deepEqual(result.plots.map(plot => plot.name), ["OHLC bars 1", "OHLC bars 2"]);
  }
  const collision = await native('plot(close,"edgelab-ohlc-bar:0")\nplotbar(10,30,0,20,color=#ff0000)\nplotbar(40,60,35,50,color=#0000ff)');
  assert.equal(collision.plots.length, 3); assert.equal(new Set(collision.plots.map(plot => plot.id)).size, 3);
  assert.ok(collision.plots.every(plot => plot.points.length === bars.length));
  const numeric = await native('plotbar(10,30,0,20,title="9",color=#ff0000)\nplotbar(40,60,35,50,title="1",color=#0000ff)');
  assert.deepEqual(numeric.plots.map(plot => plot.name), ["9", "1"]);
  assert.deepEqual(numeric.plots.map(plot => plot.points[0].value), [[10,30,0,20], [40,60,35,50]]);
});

test("omitted bar color stays absent while explicit na is transparent and series colors remain per-bar", async () => {
  const absent = await native('plotbar(80,125,75,120,title="Bars")');
  assert.equal(Object.hasOwn(absent.plots[0].options, "color"), false);
  assert.equal(Object.hasOwn(absent.plots[0].points[0].options, "color"), false);
  const defaults = install(absent); assert.ok(defaults.f.draw(defaults.installed).length);
  assert.ok(defaults.adapted.adapterWarnings.some(warning => /default color/.test(warning)));
  for (const color of ["na", "#ff000000"]) {
    const result = await native(`plotbar(80,125,75,120,title="Bars",color=${color})`), { f, installed } = install(result);
    assert.equal(result.plots[0].points[0].options.color, color === "na" ? null : color);
    assert.equal(f.draw(installed).length, 0);
  }
  const dynamic = install(await native('plotbar(80,125,75,120,color=bar_index%2==0 ? #ff0000 : #0000ff)'));
  assert.ok(dynamic.f.draw(dynamic.installed).some(rect => rect.color === "#ff0000"));
  assert.ok(dynamic.f.rectangles.some(rect => rect.color === "#0000ff"));
});

test("each required na OHLC value hides the entire bar without drawing or autoscale contamination", async () => {
  for (let missing = 0; missing < 4; missing++) {
    const values = [80, 125, 75, 120].map((value, index) => index === missing ? "na" : value);
    const result = await native(`plotbar(${values.join(",")},color=#ff0000)`), { f, installed } = install(result);
    assert.ok(result.plots[0].points.every(point => point.value === null));
    assert.equal(f.draw(installed).length, 0); assert.equal(range(installed), null);
  }
});

test("bar stem covers extrema and open-left close-right ticks leave the middle body empty under inversion and asymmetric ratios", async () => {
  for (const inverted of [false, true]) for (const [horizontalRatio, verticalRatio] of [[1, 1], [2, 2], [1, 2], [2, 1]]) {
    // Deliberately unsorted input: extrema come from all four values, not parameter names.
    const result = await native('plotbar(120,75,125,80,color=#ff000080)'), { f, installed } = install(result, bars, { inverted, horizontalRatio, verticalRatio });
    const rectangles = f.draw(installed), center = f.coordinate(2), y = price => inverted ? price : 200 - price;
    assert.equal(rectangles.filter(rect => contains(rect, center, y(100) + .25)).length, 1);
    assert.equal(rectangles.filter(rect => contains(rect, center - 3, y(120) + .25)).length, 1, "open left");
    assert.equal(rectangles.filter(rect => contains(rect, center + 3, y(80) + .25)).length, 1, "close right");
    for (const [x, price] of [[center + 3, 120], [center - 3, 80], [center - 3, 100], [center + 3, 100]]) assert.equal(rectangles.filter(rect => contains(rect, x, y(price) + .25)).length, 0);
    assert.deepEqual(range(installed), { minValue: 75, maxValue: 125 });
    // No overlap anywhere within a single bar: alpha is applied exactly once.
    const local = rectangles.filter(rect => rect.x > center - 10 && rect.x < center + 10);
    for (let a = 0; a < local.length; a++) for (let b = a + 1; b < local.length; b++) {
      assert.ok(Math.min(local[a].x + local[a].w, local[b].x + local[b].w) <= Math.max(local[a].x, local[b].x) || Math.min(local[a].y + local[a].h, local[b].y + local[b].h) <= Math.max(local[a].y, local[b].y));
    }
  }
});

test("zero-price and equal OHLC bars retain a visible one-pixel stem and both horizontal ticks", async () => {
  const result = await native('plotbar(0,0,0,0,color=#ff0000)'), { f, installed } = install(result, bars, { inverted: true });
  const rectangles = f.draw(installed), x = f.coordinate(2);
  for (const position of [x - 3, x, x + 3]) assert.ok(rectangles.some(rect => contains(rect, position, .25)));
  assert.deepEqual(range(installed), { minValue: 0, maxValue: 0 });
});

test("show_last uses source bars, display.none removes rendering, and panes and forced layers follow declaration", async () => {
  for (const overlay of [true, false]) for (const rear of [true, false]) for (const forced of [true, false]) {
    const result = await native(`plotbar(80,125,75,120,color=#ff0000,show_last=2,force_overlay=${forced})`, bars, `overlay=${overlay},behind_chart=${rear}`), { adapted, f, installed } = install(result);
    assert.equal(adapted.plots[0].overlay, overlay || forced); assert.equal(adapted.plots[0].behindChart, (overlay || forced) && rear && !forced);
    assert.equal(adapted.plots[0].visual.showFrom, 6);
    assert.ok(f.draw(installed).every(rect => rect.x >= f.coordinate(6) - 10));
  }
  const hidden = pine.adaptPineChartResult(await native('plotbar(80,125,75,120,display=display.none)'), bars);
  assert.equal(hidden.plots.length, 0);
});

test("sparse source bars use shared chart slots and clipped tick extents exclude offscreen extremes", async () => {
  const global = Array.from({ length: 24 }, (_, index) => ({ ...bars[0], time: bars[0].time + index * 60 })), snapshot = [global[0], global[10], global[20]];
  const result = await native('plotbar(80,125,75,120,color=#ff0000)', snapshot), { f, installed } = install(result, snapshot, { global, from: 9, width: 80 });
  assert.equal(f.draw(installed).length, 3); assert.ok(f.rectangles.some(rect => contains(rect, 20, 100)));
  const clipped = install(await native('plotbar(80,125,75,120,color=#ff0000)'), bars, { from: .5, width: 1 });
  assert.equal(clipped.f.draw(clipped.installed).length, 0); assert.equal(range(clipped.installed), null);
});

test("20k OHLC bars retain lazy packed backing, bounded visible decoding and disposal across pan and resize", async () => {
  const snapshot = Array.from({ length: 20000 }, (_, index) => ({ ...bars[index % bars.length], time: bars[0].time + index * 60 }));
  const result = await native('plotbar(open,high,low,close,color=#ff0000)', snapshot), { adapted, f, installed } = install(result, snapshot, { from: 19980 });
  assert.ok(pine.getPackedPinePlot(result.plots[0])); assert.equal(adapted.plots[0].segments.length, 0); assert.equal(f.series.length, 1);
  assert.deepEqual(pine.pointAtBar(result.plots[0], 19999).value, [90, 115, 85, 110]);
  f.draw(installed); assert.deepEqual(range(installed), { minValue: 85, maxValue: 115 });
  f.pan(128); f.resize(220); f.draw(installed); range(installed);
  assert.ok(installed.primitive.debugStats.decodedSamples < 100, JSON.stringify(installed.primitive.debugStats));
  installed.dispose(); installed.dispose(); assert.equal(f.removed.length, 1); assert.equal(f.listeners.size, 0); assert.equal(installed.primitive.debugStats.cacheEntries, 0);
});
