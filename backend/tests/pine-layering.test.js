import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = buildSync({
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  write: false,
  logLevel: "silent",
  stdin: {
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export * from "./frontend/src/lib/pineChartAdapter.ts"; export { Indicator, PineTS } from "pinets";',
    loader: "ts",
    resolveDir: fileURLToPath(new URL("../..", import.meta.url)),
    sourcefile: "pine-layering-oracle.ts",
  },
}).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = Array.from({ length: 32 }, (_, index) => ({
  time: 1_700_000_040 + index * 60,
  open: 90,
  high: 115,
  low: 85,
  close: 110,
  volume: index + 10,
}));
const context = { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 };
const request = (source, action = "run", snapshot = bars) => ({ id: "layer-oracle", action, source, bars: snapshot, context });
const declaration = (kind, version, flag, overlay = true) => `//@version=${version}\n${kind}("Layers",overlay=${overlay}${flag === undefined ? "" : `,behind_chart=${flag}`})\nplot(close,"Actual close",color=#ff0000)`;

for (const kind of ["indicator", "strategy"]) test(`${kind} preparation and execution preserve default and explicit layer declarations`, async () => {
  for (const version of [5, 6]) for (const flag of [undefined, "true", "false"]) {
    const source = declaration(kind, version, flag);
    for (const action of ["prepare", "run"]) {
      const result = await pine.executePineRequest(request(source, action));
      assert.equal(result.source, source);
      assert.equal(result.declaration, kind);
      assert.equal(result.pineVersion, version);
      assert.equal(result.overlay, true);
      assert.equal(result.behindChart, flag !== "false");
      if (action === "run") {
        assert.equal(result.audit.engineVersion, "0.11.0");
        assert.deepEqual(result.plots[0].points.map((point) => point.value), bars.map((bar) => bar.close));
        assert.deepEqual(result.plots[0].points.map((point) => point.time), bars.map((bar) => bar.time));
      }
    }
  }
});

test("native declaration metadata agrees with independently executed pinned engine", async () => {
  for (const kind of ["indicator", "strategy"]) for (const flag of ["true", "false"]) {
    const source = declaration(kind, 6, flag);
    const candles = bars.map((bar) => ({ ...bar, openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000 }));
    const raw = await new pine.PineTS(candles, "TEST", "1", candles.length).run(new pine.Indicator(source));
    const properties = raw.strategy?.config ?? raw.indicator;
    const native = await pine.executePineRequest(request(source));
    assert.equal(properties.behind_chart, flag === "true");
    assert.equal(native.behindChart, properties.behind_chart);
    const rawPlot = Object.values(raw.plots).find((plot) => plot.title === "Actual close");
    assert.deepEqual(native.plots[0].points.map((point) => ({ time: point.time * 1000, value: point.value })), rawPlot.data.map((point) => ({ time: point.time, value: point.value })));
  }
});

test("pane plots stay in their pane and forced plots and fills ignore the rear declaration", async () => {
  for (const overlay of [true, false]) {
    const source = `//@version=6\nindicator("Placement",overlay=${overlay},behind_chart=true)\nplot(100,"Normal")\na=plot(120,"Forced upper",force_overlay=true,display=display.none)\nb=plot(80,"Forced lower",force_overlay=true,display=display.none)\nfill(a,b,color=#ff0000,title="Forced fill")\nplot(100,"Forced",force_overlay=true)`;
    const result = await pine.executePineRequest(request(source));
    const adapted = pine.adaptPineChartResult(result, bars);
    const normal = adapted.plots.find((plot) => plot.name === "Normal");
    const forced = adapted.plots.find((plot) => plot.name === "Forced");
    const fill = adapted.plots.find((plot) => plot.name === "Forced fill");
    assert.equal(normal.overlay, overlay);
    assert.equal(normal.behindChart, overlay);
    assert.equal(forced.overlay, true);
    assert.equal(forced.behindChart, false);
    assert.equal(fill.overlay, true);
    assert.equal(fill.behindChart, false);
  }
});

test("barcolor remains a primary body override with no numeric host regardless of layering", async () => {
  for (const flag of ["true", "false"]) {
    const source = `//@version=6\nindicator("Body",overlay=false,behind_chart=${flag})\nbarcolor(#ff0000,title="Body override")`;
    const result = await pine.executePineRequest(request(source));
    const adapted = pine.adaptPineChartResult(result, bars);
    assert.equal(adapted.plots[0].kind, "barcolor");
    assert.equal(pine.latestPineChartPoint(adapted.plots[0]), null);
    const projection = pine.projectPineBarColors(adapted.plots, bars);
    assert.equal(projection.colorAt(0), "rgba(255,0,0,1)");
    assert.equal(projection.colorAt(bars.length - 1), "rgba(255,0,0,1)");
    const installed = pine.installPineChartPlots({}, adapted.plots);
    assert.equal(installed.series.length, 0);
    assert.equal(installed.primitive, undefined);
    installed.dispose();
    installed.dispose();
  }
});

test("legacy wire defaults rear while nonboolean layer metadata fails closed", async () => {
  const input = request(declaration("indicator", 6, "false"));
  const result = await pine.executePineRequest(input);
  const legacy = structuredClone(result);
  delete legacy.behindChart;
  assert.equal(pine.validatePineResponse({ id: input.id, status: "completed", result: legacy }, input).behindChart, true);
  for (const invalid of [null, 0, 1, "false", [], {}]) {
    assert.throws(() => pine.validatePineResponse({ id: input.id, status: "completed", result: { ...result, behindChart: invalid } }, input), (error) => error.code === "INVALID_MESSAGE");
  }
});

test("constant boolean aliases resolve consistently in prepare and run", async () => {
  for (const kind of ["indicator", "strategy"]) for (const value of [true, false]) {
    const source = `//@version=6\nconst bool rear = ${value}\n${kind}("Alias",overlay=true,behind_chart=rear)\nplot(close)`;
    for (const action of ["prepare", "run"]) {
      const result = await pine.executePineRequest(request(source, action));
      assert.equal(result.behindChart, action === "prepare" ? true : value);
      assert.equal(result.diagnostics.some((item) => item.code === "DECLARATION_LAYER_PENDING"), action === "prepare");
      assert.equal(result.source, source);
    }
  }
});

test("expression preparation is provisional while native execution is authoritative", async () => {
  for (const expression of ["false or false", '\"false\"']) {
    const source = declaration("indicator", 6, expression);
    const prepared = await pine.executePineRequest(request(source, "prepare"));
    assert.equal(prepared.behindChart, true);
    assert.ok(prepared.diagnostics.some((item) => item.code === "DECLARATION_LAYER_PENDING"));
    if (expression === "false or false") {
      const result = await pine.executePineRequest(request(source));
      assert.equal(result.behindChart, false);
      assert.equal(result.diagnostics.some((item) => item.code === "DECLARATION_LAYER_PENDING"), false);
    } else {
      await assert.rejects(pine.executePineRequest(request(source)), (error) => error.code === "UNSUPPORTED_DECLARATION_OPTION");
    }
  }
});

test("invalid and changing native declaration flags never return an execution result", async () => {
  for (const flag of ["na", "1", '"false"', "bar_index == 0"]) {
    await assert.rejects(pine.executePineRequest(request(declaration("indicator", 6, flag))), (error) => {
      assert.equal(error.code, "UNSUPPORTED_DECLARATION_OPTION");
      assert.match(error.message, /behind_chart/);
      return true;
    });
  }
});

test("20,000-bar packed transfer preserves rear/front metadata and exact lazy samples", async () => {
  const snapshot = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[index % bars.length], time: bars[0].time + index * 60, high: 125, close: 100 + index / 1000 }));
  for (const flag of ["true", "false"]) {
    const input = request(declaration("indicator", 6, flag), "run", snapshot);
    const result = await pine.executePineRequest(input);
    const wire = pine.toPineWireResponse(input.id, result, snapshot);
    assert.equal(wire.result.behindChart, flag === "true");
    assert.equal(wire.encoding, "pine-packed-v1");
    assert.equal(wire.buffers.length, 3);
    assert.equal(new Set(wire.buffers).size, 3);
    assert.equal(wire.buffers.reduce((total, buffer) => total + buffer.byteLength, 0), 220_000);
    const received = structuredClone(wire, { transfer: wire.buffers });
    assert.ok(wire.buffers.every((buffer) => buffer.byteLength === 0));
    const canonical = pine.validatePineResponse(received, input);
    assert.equal(canonical.behindChart, flag === "true");
    assert.ok(pine.getPackedPinePlot(canonical.plots[0]));
    for (const index of [0, 10_000, 19_999]) {
      assert.equal(pine.pointAtBar(canonical.plots[0], index).time, snapshot[index].time);
      assert.equal(pine.pointAtBar(canonical.plots[0], index).value, snapshot[index].close);
    }
    const reencoded = pine.toPineWireResponse(input.id, canonical, snapshot);
    assert.equal(reencoded.result.behindChart, canonical.behindChart);
    assert.equal(reencoded.buffers[0], received.buffers[0]);
  }
});

test("custom candles preserve independent raw OHLC, omitted colors, explicit na and pane price bounds", async () => {
  for (const colors of ["", ",color=na,wickcolor=na,bordercolor=na", ",color=#ff000080,wickcolor=#0000ff,bordercolor=#00ff00"]) {
    const source = `//@version=6\nindicator("Candle oracle",overlay=false,behind_chart=false)\nplotcandle(80,125,75,120,title="Candles"${colors})`;
    const candles = bars.map((bar) => ({ ...bar, openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000 }));
    const raw = await new pine.PineTS(candles, "TEST", "1", candles.length).run(new pine.Indicator(source));
    const expected = Object.values(raw.plots).find((plot) => plot.title === "Candles");
    const result = await pine.executePineRequest(request(source));
    const plot = result.plots[0];
    const options = (value) => Object.fromEntries(Object.entries(value).filter(([key, item]) => !key.startsWith("_") && item !== undefined).map(([key, item]) => [key, typeof item === "number" && Number.isNaN(item) ? null : item]));
    assert.deepEqual(plot.options, options(expected.options));
    assert.deepEqual(plot.points.map((point) => point.value), expected.data.map((point) => point.value));
    assert.ok(plot.points.every((point) => JSON.stringify(point.value) === "[80,125,75,120]"));
    for (let index = 0; index < bars.length; index++) {
      assert.deepEqual(plot.points[index].options, options(expected.data[index].options));
      assert.equal(plot.points[index].time, bars[index].time);
    }
    if (colors === "") {
      assert.equal(Object.hasOwn(plot.options, "color"), false);
      assert.equal(Object.hasOwn(plot.points[0].options, "wickcolor"), false);
    } else if (colors.includes("color=na")) {
      assert.equal(plot.points[0].options.color, null);
      assert.equal(plot.points[0].options.wickcolor, null);
      assert.equal(plot.points[0].options.bordercolor, null);
    }
    const adapted = pine.adaptPineChartResult(result, bars);
    assert.equal(adapted.plots[0].kind, "candles");
    assert.equal(adapted.plots[0].overlay, false);
    assert.ok(adapted.plots[0].visual);
  }
});
