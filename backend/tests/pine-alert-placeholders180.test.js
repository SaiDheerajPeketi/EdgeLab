import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
// Actual reviewed compiler, native helpers and worker. Registry correspondence
// alone does not prove named-condition subscriptions or notification delivery.
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-alert-placeholders180.ts",
    contents: 'export {Indicator,PineTS} from "pinets";export * from "./frontend/src/workers/pineNative.worker";export * from "./frontend/src/lib/pineAlertPlaceholders";export * from "./frontend/src/lib/pineProtocol";export * from "./frontend/src/lib/pinePacked";' } })).outputFiles[0].text;
console.info("PINE_ALERT_PLACEHOLDERS180_BINDING " + JSON.stringify({ minified: true, actualWorker: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const bars = Array.from({ length: 4 }, (_, index) => ({ time: origin + index * 60, open: 100 + index,
  high: 105 + index, low: 95 + index, close: 102 + index, volume: 10 + index }));
const program = (body, version = 6) => `//@version=${version}\nindicator("Authored alert plots180",overlay=true)\n${body}`;
const registry = script => {
  const compiled = new pine.Indicator(script).prepare({ debug: false, ln: false });
  const field = Object.getOwnPropertyDescriptor(compiled.fn, "_edgelabAlertPlots");
  assert.ok(field && "value" in field, "actual compiled function owns the authored registry");
  return field.value;
};
const native = (script, history = bars) => new pine.PineTS(history.map(bar => ({ ...bar, openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000 - 1 })),
  "BINANCE:BTCUSDT", "1", history.length).run(new pine.Indicator(script));
// Array-backed PineTS supplies price data but no requested-market metadata.
// This genuine provider supplies the actual symbol/timeframe for the security
// sibling regression; no compiler, execution or calculated values are mocked.
const nativeWithProvider = (script, history) => {
  const candles = history.map(bar => ({ ...bar, openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000 - 1 }));
  const provider = { configure() {}, async getMarketData(symbol, timeframe, limit, start, end) {
    assert.equal(symbol, "BINANCE:BTCUSDT"); assert.equal(timeframe, "1");
    const actual = candles.filter(bar => (start === undefined || bar.openTime >= start) && (end === undefined || bar.openTime <= end));
    return (limit === undefined ? actual : actual.slice(-limit)).map(bar => ({ ...bar }));
  }, async getSymbolInfo(symbol) { assert.equal(symbol, "BINANCE:BTCUSDT");
    return { tickerid: symbol, ticker: "BTCUSDT", timezone: "UTC", session: "24x7", currency: "USDT", basecurrency: "BTC", mintick: .01, pricescale: 100, minmove: 1, pointvalue: 1 };
  } };
  return new pine.PineTS(provider, "BINANCE:BTCUSDT", "1", history.length).run(new pine.Indicator(script));
};
const worker = script => pine.executePineRequest({ id: "alert-plots180", action: "run", mode: "historical", source: script, bars,
  context: { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1 } });
const channel = (context, entry) => {
  const matches = Object.values(context.plots).filter(plot => plot._callsiteId === entry.callsiteId);
  assert.equal(matches.length, 1, "each authored identity resolves exactly one genuine native channel");
  return matches[0];
};
// Chart transport IDs are native map keys (often titles), not callsite IDs.
// Match the genuine channel's actual key; authored sampling uses _callsiteId.
const wireChannel = (wire, context, entry) => {
  const plot = channel(context, entry), key = Object.entries(context.plots).find(([, value]) => value === plot)?.[0];
  assert.equal(typeof key, "string"); const matches = wire.plots.filter(value => value.id === key);
  assert.equal(matches.length, 1); return matches[0];
};
const capture = (context, entries, time = bars.at(-1).time) => pine.capturePineAlertPlots(context.plots, entries, time * 1000);
const messageContext = plots => ({ ticker: "BTCUSDT", exchange: "BINANCE", interval: "1", currency: "USDT", basecurrency: "BTC",
  bar: bars.at(-1), receivedAt: Date.UTC(2024, 0, 1, 0, 3, 45, 987), plots });

test("v5/v6 authored order survives numeric titles, duplicate titles, hidden and NA scalar plots beyond the first 20 slots", async () => {
  const titles = ["9", "1", "Duplicate", "Duplicate", "Hidden", "NA", ...Array.from({ length: 17 }, (_, index) => `Tail ${index}`)];
  const body = titles.map((title, index) => `plot(${index === 5 ? "na" : index + 10},"${title}"${index === 4 ? ",display=display.none" : ""})`).join("\n");
  for (const version of [5, 6]) {
    const script = program(body, version), entries = registry(script), result = await native(script);
    assert.equal(entries.length, 23); assert.deepEqual(entries.map(entry => entry.title), titles);
    assert.deepEqual(entries.map(entry => entry.width), titles.map(() => 1));
    assert.equal(new Set(entries.map(entry => entry.callsiteId)).size, titles.length);
    for (const [index, entry] of entries.entries()) {
      const plot = channel(result, entry); assert.equal(plot.title, titles[index]);
      assert.equal(plot.data.length, bars.length);
      for (const point of plot.data) if (index === 5) assert.ok(Number.isNaN(point.value)); else assert.equal(point.value, index + 10);
    }
    assert.equal(channel(result, entries[4]).options.display, "none");
    const sampled = capture(result, entries);
    assert.deepEqual(sampled.numbered, Array.from({ length: 20 }, (_, index) => index === 5 ? null : index + 10));
    assert.deepEqual(sampled.named, titles.flatMap((title, index) => index === 3 ? [] : [{ title, value: index === 5 ? null : index + 10 }]));
    assert.equal(pine.resolvePineAlertMessage('{{plot_4}}|{{plot_5}}|{{plot_19}}|{{plot_20}}|{{plot("Duplicate")}}|{{plot("Tail 16")}}', messageContext(sampled)),
      '14|NaN|29|{{plot_20}}|12|32');
    const wire = await worker(script); assert.equal(wire.plots.length, titles.length);
    for (const [index, entry] of entries.entries()) assert.equal(wireChannel(wire, result, entry).name, titles[index]);
  }
});

test("native bars and candles own four ordered OHLC values and independently retain partial NA fields", async () => {
  for (const version of [5, 6]) {
    const script = program('plot(1,"Before")\nplotbar(11,14,9,12,title="Bars")\nplotcandle(21,24,19,22,title="Candles")\nplotbar(31,na,29,32,title="Partial")\nplot(2,"After")', version);
    const entries = registry(script), result = await native(script);
    assert.deepEqual(entries.map(entry => [entry.title, entry.width]), [["Before", 1], ["Bars", 4], ["Candles", 4], ["Partial", 4], ["After", 1]]);
    for (const [index, expected] of [[1, [11, 14, 9, 12]], [2, [21, 24, 19, 22]]])
      assert.deepEqual(channel(result, entries[index]).data.map(point => point.value), bars.map(() => expected));
    for (const point of channel(result, entries[3]).data) {
      assert.equal(point.value[0], 31); assert.ok(Number.isNaN(point.value[1])); assert.equal(point.value[2], 29); assert.equal(point.value[3], 32);
    }
    assert.deepEqual(capture(result, entries), { numbered: [1, 11, 14, 9, 12, 21, 24, 19, 22, 31, null, 29, 32, 2],
      named: [{ title: "Before", value: 1 }, { title: "After", value: 2 }] });
    const wire = await worker(script);
    for (const [index, expected] of [[1, [11, 14, 9, 12]], [2, [21, 24, 19, 22]]])
      assert.deepEqual(wireChannel(wire, result, entries[index]).points.map(point => point.value), bars.map(() => expected));
  }
});

test("actual shape and char booleans differ from numeric absolute markers and signed arrow series", async () => {
  for (const version of [5, 6]) {
    const script = program('plotshape(bar_index%2==0,title="Shape")\nplotchar(bar_index%2==0,title="Char",char="x")\nplotshape(bar_index-2,title="Absolute",location=location.absolute)\nplotarrow(bar_index-2,title="Arrow")', version);
    const entries = registry(script), result = await native(script);
    assert.deepEqual(entries.map(entry => [entry.title, entry.width]), [["Shape", 1], ["Char", 1], ["Absolute", 1], ["Arrow", 1]]);
    for (const index of [0, 1]) assert.deepEqual(channel(result, entries[index]).data.map(point => point.value), [true, false, true, false]);
    for (const index of [2, 3]) assert.deepEqual(channel(result, entries[index]).data.map(point => point.value), [-2, -1, 0, 1]);
    assert.deepEqual(capture(result, entries).numbered, [0, 0, 1, 1]);
    const wire = await worker(script); assert.equal(wire.plots.length, 4);
    for (const entry of entries) assert.deepEqual(wireChannel(wire, result, entry).points.map(point => point.time), bars.map(bar => bar.time));
  }
});

test("native hline, fill, background and bar colors do not consume authored alert slots; plots after conditions do", async () => {
  for (const version of [5, 6]) {
    const script = program('alertcondition(close>open,"After declaration",\'{{plot("After")}}\')\nhline(100,"Level")\na=plot(1,"First")\nb=plot(2,"Second")\nfill(a,b,#ff000080,title="Fill")\nbgcolor(#0000ff80,title="Background")\nbarcolor(#00ff00,title="Bar color")\nplot(3,"After")', version);
    const entries = registry(script), result = await native(script);
    assert.deepEqual(entries.map(entry => [entry.title, entry.width]), [["First", 1], ["Second", 1], ["After", 1]]);
    assert.deepEqual(entries.map(entry => channel(result, entry).data.at(-1).value), [1, 2, 3]);
    assert.deepEqual(capture(result, entries).numbered, [1, 2, 3]);
    const wire = await worker(script); assert.equal(Object.hasOwn(wire, "alertEvents"), false);
    assert.deepEqual(wire.alertConditions, [{ id: "alertcondition_0", title: "After declaration", message: '{{plot("After")}}' }]);
  }
});

test("the first 20 flattened slots may end midway through an OHLC call without losing later scalar title lookup", async () => {
  const body = Array.from({ length: 18 }, (_, index) => `plot(${index + 1},"Scalar ${index}")`).join("\n")
    + '\nplotcandle(71,75,69,73,title="OHLC")\nplot(81,"After twenty",display=display.none)';
  for (const version of [5, 6]) {
    const script = program(body, version), entries = registry(script), result = await native(script), sampled = capture(result, entries);
    assert.deepEqual(sampled.numbered, [...Array.from({ length: 18 }, (_, index) => index + 1), 71, 75]);
    assert.equal(sampled.named.find(entry => entry.title === "After twenty")?.value, 81);
    assert.equal(sampled.named.some(entry => entry.title === "OHLC"), false);
    assert.equal(pine.resolvePineAlertMessage('{{plot_18}} {{plot_19}} {{plot_20}} {{plot("OHLC")}} {{plot("After twenty")}}', messageContext(sampled)),
      '71 75 {{plot_20}} {{plot("OHLC")}} 81');
  }
});

test("real calculated hidden and offset values sample their authored bar before display projection, with no stale last-bar fallback", async () => {
  const script = program('alertcondition(true,"Sample after execution",\'{{plot("After")}}\')\nplot(close*3,"After",display=display.none,offset=7)\nplot(1e-10,"Tiny")');
  const entries = registry(script), result = await native(script), sampled = capture(result, entries);
  assert.deepEqual(sampled.numbered, [315, 1e-10]);
  assert.equal(pine.resolvePineAlertMessage('{{plot("After")}} {{plot("Tiny")}}', messageContext(sampled)), '315 0.0000000001');
  assert.deepEqual(capture(result, entries, bars.at(-1).time + 60).numbered, [null, null]);
  const workerResult = await worker(script); assert.equal(workerResult.plots[0].points.at(-1).value, 315);
  assert.equal(workerResult.plots[0].options.offset, 7); assert.equal(Object.hasOwn(workerResult, "alertEvents"), false);
});

test("actual sampled plots and actual last OHLC expand plain-text instrument and UTC timestamps without rescanning substitutions", async () => {
  const script = program('plot(close,"Price")'), sampled = capture(await native(script), registry(script));
  const template = '{{exchange}}:{{ticker}} {{interval}} {{syminfo.currency}}/{{syminfo.basecurrency}} {{open}} {{high}} {{low}} {{close}} {{volume}} {{time}} {{timenow}} {{plot_0}} {{plot("Price")}} {{unknown}}';
  assert.equal(pine.resolvePineAlertMessage(template, messageContext(sampled)),
    'BINANCE:BTCUSDT 1 USDT/BTC 103 108 98 105 13 2024-01-01T00:03:00Z 2024-01-01T00:03:45Z 105 105 {{unknown}}');
  assert.equal(pine.resolvePineAlertMessage('{{ticker}} {{close}}', { ...messageContext(sampled), ticker: '{{close}}' }), '{{close}} 105');
  assert.throws(() => pine.resolvePineAlertMessage('X'.repeat(4080) + '{{timenow}}', messageContext(sampled)), error => error.code === "INVALID_ALERT_PLACEHOLDERS");
});

test("actual custom plot function execution is excluded while a differently named native helper remains eligible", async () => {
  for (const version of [5, 6]) {
    const script = program('plot(value)=>value*2\nx=plot(close)\nplotchar(x,title="Custom result",char="x",location=location.absolute)', version);
    const entries = registry(script), result = await native(script);
    assert.deepEqual(entries.map(entry => [entry.title, entry.width]), [["Custom result", 1]]);
    assert.deepEqual(channel(result, entries[0]).data.map(point => point.value), bars.map(bar => bar.close * 2));
    const wire = await worker(script); assert.equal(wire.plots.length, 1);
  }
});

test("actual dot and direct user methods named plot remain distinct from a bare native plot", async () => {
  const body = 'type Marker\n    float value\nmethod plot(Marker self,float value)=>self.value+value\nm=Marker.new(7)\na=m.plot(close)\nb=plot(m,close)\nplot(close,"Native")\nplotchar(a,title="Dot result",char="x",location=location.absolute)\nplotchar(b,title="Direct result",char="x",location=location.absolute)';
  for (const version of [5, 6]) {
    const script = program(body, version), entries = registry(script), result = await native(script);
    assert.deepEqual(entries.map(entry => [entry.title, entry.width]), [["Native", 1], ["Dot result", 1], ["Direct result", 1]]);
    assert.deepEqual(channel(result, entries[0]).data.map(point => point.value), bars.map(bar => bar.close));
    for (const entry of entries.slice(1)) assert.deepEqual(channel(result, entry).data.map(point => point.value), bars.map(bar => bar.close + 7));
  }
});

test("native registry preserves a 4096-character constant plot title and expands finite tiny/huge values as fixed-point text", async () => {
  const title = "T".repeat(4096), script = program(`plot(1e-10,"${title}")\nplot(-1e21,"Huge")`), entries = registry(script);
  assert.equal(entries[0].title, title);
  const sampled = capture(await native(script), entries);
  assert.equal(sampled.named[0].title, title); assert.deepEqual(sampled.numbered, [1e-10, -1e21]);
  assert.equal(pine.resolvePineAlertMessage('{{plot_0}} {{plot_1}} {{plot("Huge")}}', messageContext(sampled)),
    '0.0000000001 -1000000000000000000000 -1000000000000000000000');
});

test("malformed or accessor-owned registry/message inputs are refused without executing getters", async () => {
  const script = program('plot(close,"Price")'), entries = registry(script), result = await native(script);
  for (const mutate of [value => { value[0].width = 2; }, value => { value[0].extra = true; },
    value => { value.push({ ...value[0] }); }, value => { delete value[0]; }]) {
    const invalid = structuredClone(entries); mutate(invalid);
    assert.throws(() => pine.capturePineAlertPlots(result.plots, invalid, bars.at(-1).time * 1000));
  }
  let getters = 0; const accessor = structuredClone(entries);
  Object.defineProperty(accessor[0], "title", { enumerable: true, get() { getters++; return "Price"; } });
  assert.throws(() => pine.capturePineAlertPlots(result.plots, accessor, bars.at(-1).time * 1000)); assert.equal(getters, 0);
  const context = messageContext(capture(result, entries));
  context.bar = { ...context.bar }; Object.defineProperty(context.bar, "close", { enumerable: true, get() { getters++; return 105; } });
  assert.throws(() => pine.resolvePineAlertMessage('{{close}}', context)); assert.equal(getters, 0);
  const malformed = messageContext(capture(result, entries)); malformed.plots.numbered[0] = Infinity;
  assert.throws(() => pine.resolvePineAlertMessage('{{plot_0}}', malformed));
});

test("user marker text is inert and only actual Pine authored calls receive metadata, with 64 sites retained", async () => {
  const script = program('// /*__edgelabAlertPlot:3:1*/\nnote="/*__edgelabAlertPlot:3:1*/"\nplot(str.length(note),"Actual")');
  const entries = registry(script), result = await native(script);
  assert.deepEqual(entries.map(entry => [entry.title, entry.width]), [["Actual", 1]]);
  assert.equal(channel(result, entries[0]).data.at(-1).value, '/*__edgelabAlertPlot:3:1*/'.length);
  const plain = new pine.Indicator(() => undefined).prepare({ debug: false, ln: false });
  assert.equal(plain.fn._edgelabAlertPlots, undefined);
  const sixtyFour = registry(program(Array.from({ length: 64 }, (_, index) => `plot(${index},"Slot ${index}")`).join("\n")));
  assert.equal(sixtyFour.length, 64); assert.equal(sixtyFour[63].title, "Slot 63");
  assert.equal(Object.hasOwn(registry(program('plot(close,str.tostring(bar_index))'))[0], "title"), false);
});

test("compiled registries and each descriptor are frozen, including the no-eligible-plots case", () => {
  for (const body of ['plot(close)\nplot(close,"",display=display.none)', 'hline(100)\nbgcolor(#ff0000)']) {
    const entries = registry(program(body)); assert.equal(Object.isFrozen(entries), true);
    for (const entry of entries) { assert.equal(Object.isFrozen(entry), true); assert.equal(typeof entry.callsiteId, "string"); }
    assert.throws(() => entries.push({ callsiteId: "forged", width: 1 }), TypeError);
    if (entries.length) {
      assert.equal(Object.hasOwn(entries[0], "title"), false); assert.equal(entries[1].title, "");
      assert.throws(() => { entries[0].callsiteId = "forged"; }, TypeError);
    } else assert.equal(entries.length, 0);
  }
});

test("message validation rejects invalid contexts, every later duplicate value and nonfinite actual OHLC without mutating a valid snapshot", async () => {
  const script = program('plot(close,"Price")'), sampled = capture(await native(script), registry(script)), valid = messageContext(sampled);
  const expected = structuredClone(valid), invalid = error => error instanceof pine.PineProtocolError
    && ["INVALID_MESSAGE", "INVALID_ALERT_PLACEHOLDERS"].includes(error.code);
  for (const context of [null, undefined, false, 1, "context", [], { ...valid, bar: null }, { ...valid, plots: null }])
    assert.throws(() => pine.resolvePineAlertMessage('{{close}}', context), invalid);
  for (const second of [{ title: "Price", value: Infinity }, { title: "Price", value: NaN }, { title: "Price", value: 105, extra: true },
    { title: "Price" }, { title: "Price", value: "105" }]) {
    const context = structuredClone(valid); context.plots.named.push(second);
    assert.throws(() => pine.resolvePineAlertMessage('{{plot("Price")}}', context), invalid);
  }
  for (const field of ["open", "high", "low", "close", "volume"]) for (const value of [null, undefined, NaN, Infinity, "105", true]) {
    const context = structuredClone(valid); context.bar[field] = value;
    assert.throws(() => pine.resolvePineAlertMessage('{{close}}', context), invalid);
  }
  assert.equal(pine.resolvePineAlertMessage('{{close}} {{plot("Price")}}', valid), '105 105'); assert.deepEqual(valid, expected);
});

test("source-visible constant title aliases are proved without borrowing a later unresolved forward binding", async () => {
  const script = program('const string ROOT="Known"\nconst string TITLE=ROOT+" title"\nplot(close,TITLE)\nplot(close+1,title=TITLE)');
  const entries = registry(script), result = await native(script);
  assert.deepEqual(entries.map(entry => entry.title), ["Known title", "Known title"]);
  assert.deepEqual(entries.map(entry => channel(result, entry).data.at(-1).value), [105, 106]);
  assert.deepEqual(capture(result, entries).named, [{ title: "Known title", value: 105 }]);
  // This metadata-only admission probe deliberately has an unresolved forward
  // reference. It cannot establish a constant title from a later declaration,
  // and is not presented as an executable valid-Pine notification example.
  const forward = registry(program('ALIAS=LATER\nconst string LATER="Future"\nplot(close,ALIAS)\nplot(close,LATER)'));
  assert.equal(Object.hasOwn(forward[0], "title"), false); assert.equal(forward[1].title, "Future");
});

const mixedPlots = 'plotbar(open,high,low,close,title="9")\nplotcandle(open+10,high+10,low+10,close+10,title="1")\nplotbar(open+20,high+20,low+20,close+20,title="Same")\nplotcandle(open+30,high+30,low+30,close+30,title="Same")\nother=request.security(syminfo.tickerid,"1",close*2)\nplot(other,"Request")\nalertcondition(false,"No notification",\'{{plot("Request")}}\')';
const mixedValues = bar => [0, 10, 20, 30].map(offset => [bar.open + offset, bar.high + offset, bar.low + offset, bar.close + offset]);
const actualPoint = (plot, index) => pine.getPackedPinePlot(plot) ? pine.pointAtBar(plot, index) : plot.points[index];
const assertMixed = (result, bar, index) => {
  assert.equal(result.plots.length, 5); assert.equal(new Set(result.plots.map(plot => plot.id)).size, 5);
  for (const [lane, values] of mixedValues(bar).entries()) {
    const matches = result.plots.filter(plot => JSON.stringify(actualPoint(plot, index)?.value) === JSON.stringify(values));
    assert.equal(matches.length, 1); assert.equal(matches[0].style, lane % 2 ? "candle" : "bar");
    assert.equal(matches[0].name, ["9", "1", "Same", "Same"][lane]);
    assert.equal(actualPoint(matches[0], index).time, bar.time);
  }
  const requestPoint = actualPoint(result.plots.find(plot => plot.name === "Request"), index);
  assert.equal(requestPoint?.value, bar.close * 2); assert.equal(requestPoint.time, bar.time);
  assert.equal(Object.hasOwn(result, "alertEvents"), false);
};

test("packed genuine historical mixed bar/candle channels stay independent beside a same-symbol security expression", async () => {
  const history = Array.from({ length: 1025 }, (_, index) => ({ ...bars[index % bars.length], time: origin + index * 60 })), script = program(mixedPlots);
  const entries = registry(script); assert.deepEqual(entries.map(entry => [entry.title, entry.width]), [["9", 4], ["1", 4], ["Same", 4], ["Same", 4], ["Request", 1]]);
  const request = { id: "packed-alert-plots180", action: "run", mode: "historical", source: script, bars: history,
    context: { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1 } };
  const actual = await pine.executePineRequest(request), wire = pine.toPineWireResponse(request.id, actual, history);
  assert.equal(wire.encoding, "pine-packed-v1");
  const decoded = pine.validatePineResponse(wire, request); assertMixed(decoded, history[0], 0); assertMixed(decoded, history.at(-1), history.length - 1);
  const raw = await nativeWithProvider(script, history), sampled = capture(raw, entries, history.at(-1).time);
  assert.deepEqual(sampled.numbered, [...mixedValues(history.at(-1)).flat(), history.at(-1).close * 2]);
  assert.deepEqual(sampled.named, [{ title: "Request", value: history.at(-1).close * 2 }]);
});

test("persistent actual live mixed channels preserve identities through replacement, confirmation and append without notifications", async () => {
  const script = program(mixedPlots), executor = pine.createPineLiveExecutor(), sessionId = "mixed-alert-plots180";
  const request = { id: sessionId + ":0", action: "run", mode: "live", source: script, bars,
    context: { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1 } };
  try {
    const initial = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request });
    assertMixed(initial, bars.at(-1), bars.length - 1); const ids = initial.plots.map(plot => plot.id), before = structuredClone(initial);
    let sequence = 0;
    for (const [index, close, confirmed] of [[4, 106, false], [4, 107, false], [4, 108, true], [5, 109, false]]) {
      const bar = { time: origin + index * 60, open: 104 + (index - 4), high: 110 + (index - 4), low: 99, close, volume: 20 + sequence };
      const actual = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, action: "update", bar, confirmed });
      assertMixed(actual, bar, index); assert.deepEqual(actual.plots.map(plot => plot.id), ids);
    }
    assert.deepEqual(initial, before);
  } finally { executor.dispose(); }
});

test("all six native helpers retain valid named enums/colors beside matching dot/direct methods and ordinary function shadows", async () => {
  const helpers = [
    { name: "plot", call: 'plot(close,title="Native",color=#ff0000,style=plot.style_histogram,display=display.none)', values: bars.map(bar => bar.close), width: 1 },
    { name: "plotchar", call: 'plotchar(close>open,title="Native",char="x",location=location.top,color=#ff0000,display=display.none)', values: bars.map(() => true), width: 1 },
    { name: "plotshape", call: 'plotshape(close>open,title="Native",style=shape.circle,location=location.top,color=#ff0000,size=size.small,display=display.none)', values: bars.map(() => true), width: 1 },
    { name: "plotarrow", call: 'plotarrow(close-open,title="Native",colorup=#ff0000,colordown=#0000ff,minheight=5,maxheight=50,display=display.none)', values: bars.map(bar => bar.close - bar.open), width: 1 },
    { name: "plotbar", call: 'plotbar(open,high,low,close,title="Native",color=#ff0000,display=display.none)', values: bars.map(bar => [bar.open, bar.high, bar.low, bar.close]), width: 4 },
    { name: "plotcandle", call: 'plotcandle(open,high,low,close,title="Native",color=#ff0000,wickcolor=#0000ff,bordercolor=#00ff00,display=display.none)', values: bars.map(bar => [bar.open, bar.high, bar.low, bar.close]), width: 4 },
  ];
  for (const version of [5, 6]) for (const helper of helpers) {
    const resultHelper = helper.name === "plotchar" ? "plot" : "plotchar";
    const resultCall = (value, title) => resultHelper === "plot" ? `plot(${value},"${title}")`
      : `plotchar(${value},title="${title}",char="x",location=location.absolute)`;
    const body = `type Marker\n    float value\nmethod ${helper.name}(Marker self,float value)=>self.value+value\nm=Marker.new(7)\na=m.${helper.name}(close)\nb=${helper.name}(m,close)\n${helper.call}\n${resultCall("a", "Dot result")}\n${resultCall("b", "Direct result")}`;
    const script = program(body, version), entries = registry(script), raw = await native(script), actual = await worker(script);
    assert.deepEqual(entries.map(entry => [entry.title, entry.width]), [["Native", helper.width], ["Dot result", 1], ["Direct result", 1]], `${version} ${helper.name} registry`);
    assert.deepEqual(channel(raw, entries[0]).data.map(point => point.value), helper.values, `${version} ${helper.name} native values`);
    assert.equal(channel(raw, entries[0]).options.display, "none"); assert.equal(wireChannel(actual, raw, entries[0]).options.display, "none");
    for (const entry of entries.slice(1)) {
      assert.deepEqual(channel(raw, entry).data.map(point => point.value), bars.map(bar => bar.close + 7));
      assert.deepEqual(wireChannel(actual, raw, entry).points.map(point => point.value), bars.map(bar => bar.close + 7));
    }
    assert.equal(Object.hasOwn(actual, "alertEvents"), false);
    const ordinary = program(`${helper.name}(value)=>value*3\nx=${helper.name}(close)\n${resultCall("x", "Ordinary result")}`, version);
    const ordinaryEntries = registry(ordinary), ordinaryRaw = await native(ordinary), ordinaryWire = await worker(ordinary);
    assert.deepEqual(ordinaryEntries.map(entry => [entry.title, entry.width]), [["Ordinary result", 1]]);
    assert.deepEqual(channel(ordinaryRaw, ordinaryEntries[0]).data.map(point => point.value), bars.map(bar => bar.close * 3));
    assert.deepEqual(wireChannel(ordinaryWire, ordinaryRaw, ordinaryEntries[0]).points.map(point => point.value), bars.map(bar => bar.close * 3));
  }
});

test("immutable lexical hex aliases and hex/NA branches remain native, while later mutation refuses only the untyped fallback", async () => {
  const method = 'type Marker\n    float value\nmethod plot(Marker self,float value)=>self.value+value';
  for (const version of [5, 6]) {
    const body = method + '\nHEX=#ff0000\nALIAS=HEX\nplot(close,title="Alias",color=ALIAS)\nplot(close+1,title="Branch",color=bar_index%2==0?ALIAS:na)';
    const script = program(body, version), entries = registry(script), raw = await native(script), actual = await worker(script);
    assert.deepEqual(entries.map(entry => entry.title), ["Alias", "Branch"]);
    assert.deepEqual(channel(raw, entries[0]).data.map(point => point.value), bars.map(bar => bar.close));
    assert.deepEqual(wireChannel(actual, raw, entries[0]).points.map(point => point.options.color), bars.map(() => "#ff0000"));
    assert.deepEqual(wireChannel(actual, raw, entries[1]).points.map(point => point.options.color), ["#ff0000", null, "#ff0000", null]);
    assert.deepEqual(capture(raw, entries).numbered, [105, 106]);
    const mutated = '\nHEX=#ff0000\nplot(close,title="Mutable",color=HEX)\nHEX:=#0000ff';
    assert.throws(() => registry(program(method + mutated, version)), /transpile|native plot color/i);
    // The fallback refusal does not change an ordinary native call or the
    // separately established typed-color native path.
    for (const ordinary of [program(mutated, version), program(method + mutated.replace('HEX=#ff0000', 'color HEX=#ff0000'), version)]) {
      const ordinaryEntries = registry(ordinary), ordinaryRaw = await native(ordinary), ordinaryWire = await worker(ordinary);
      assert.deepEqual(ordinaryEntries.map(entry => entry.title), ["Mutable"]);
      assert.deepEqual(wireChannel(ordinaryWire, ordinaryRaw, ordinaryEntries[0]).points.map(point => point.value), bars.map(bar => bar.close));
      assert.deepEqual(wireChannel(ordinaryWire, ordinaryRaw, ordinaryEntries[0]).points.map(point => point.options.color), bars.map(() => "#ff0000"));
    }
  }
});

test("quoted hex strings preserve matching user-method dispatch and arbitrary string colors do not gain native fallback", async () => {
  for (const version of [5, 6]) {
    const script = program('method plot(string self,float value)=>value+str.length(self)\nhexText="#ff0000"\na=hexText.plot(close)\nb=plot("#ff0000",close)\nplotchar(a,title="Dot string",char="x",location=location.absolute)\nplotchar(b,title="Direct string",char="x",location=location.absolute)', version);
    const entries = registry(script), raw = await native(script), actual = await worker(script);
    assert.deepEqual(entries.map(entry => entry.title), ["Dot string", "Direct string"]);
    for (const entry of entries) {
      assert.deepEqual(channel(raw, entry).data.map(point => point.value), bars.map(bar => bar.close + 7));
      assert.deepEqual(wireChannel(actual, raw, entry).points.map(point => point.value), bars.map(bar => bar.close + 7));
    }
    assert.throws(() => registry(program('type Marker\n    float value\nmethod plot(Marker self,float value)=>self.value+value\nplot(close,title="Invalid",color="not-a-native-color")', version)), /transpile|overload/i);
  }
});
