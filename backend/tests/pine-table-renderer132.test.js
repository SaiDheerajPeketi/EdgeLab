import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
const bundle = buildSync({ bundle: true, platform: "browser", format: "esm", write: false, logLevel: "silent",
  stdin: { contents: 'export * from "./frontend/src/lib/pineChartAdapter.ts"; export * from "./frontend/src/lib/pineTablePrimitive.ts";', loader: "ts", resolveDir: new URL("../../", import.meta.url).pathname },
}).outputFiles[0].text;
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const cell = (text, settings = {}) => ({ populated: true, text, width: 0, height: 0, textColor: "#ffffff", textHalign: "center", textValign: "center", textSize: 14, bgcolor: null, tooltip: "", textFontFamily: "default", textFormatting: "none", ...settings });
const table = (cells, settings = {}) => ({ id: "1", position: "top_right", columns: cells[0].length, rows: cells.length, cells, merges: [], bgcolor: null, frameColor: null, frameWidth: 0, borderColor: null, borderWidth: 0, overlay: true, forceOverlay: false, ...settings });
const pane = { width: 1000, height: 500 }, measure = text => ({ width: text.length * 10, height: 20 });
test("sparse table allocation stays invisible while populated blanks keep their axes", () => {
  const empty = pine.layoutPineTable(table([[null, null], [null, cell("setter", { populated: false })]]), pane, measure);
  assert.deepEqual(empty, { width: 0, height: 0, cells: [] });
  const sparse = pine.layoutPineTable(table([[null, null, null], [null, cell(""), null]]), pane, measure);
  assert.equal(sparse.width, 8); assert.equal(sparse.height, 28); assert.equal(sparse.cells.length, 1);
  assert.equal(sparse.cells[0].x, 0); assert.equal(sparse.cells[0].y, 0);
});
test("explicit percentages can exceed the pane; neighboring cells share column/row maxima", () => {
  const layout = pine.layoutPineTable(table([[cell("A", { width: 125, height: 20 }), cell("BB")], [cell("longer"), cell("C", { width: 5, height: 30 })]]), pane, measure);
  assert.equal(layout.width, 1300); assert.equal(layout.height, 250);
  assert.deepEqual(layout.cells.map(c => [c.x, c.y, c.width, c.height]), [[0, 0, 1250, 100], [1250, 0, 50, 100], [0, 100, 1250, 150], [1250, 100, 50, 150]]);
});
test("merged origins use neighboring dimensions, ignore their own percentages and cover children once", () => {
  const t = table([[cell("origin", { width: 999, height: 999 }), cell("ignored")], [cell("a", { width: 10 }), cell("b", { width: 20 })]], { merges: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }] });
  const layout = pine.layoutPineTable(t, pane, measure);
  assert.equal(layout.width, 300); assert.equal(layout.cells.length, 3); assert.equal(layout.cells[0].width, 300);
  assert.ok(!layout.cells.some(c => c.cell.text === "ignored")); assert.ok(layout.height < pane.height);
});
test("merge-only automatic width is independent of the order of short and long rows", () => {
  const merge = row => ({ startCol: 0, startRow: row, endCol: 1, endRow: row });
  const make = texts => pine.layoutPineTable(table(texts.map(text => [cell(text), null]), { merges: [merge(0), merge(1)] }), pane, measure);
  const a = make(["A", "A much longer heading"]), b = make(["A much longer heading", "A"]);
  assert.equal(a.width, 218); assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  assert.equal(a.cells[0].width, a.cells[1].width);
});
test("viewport table adapter survives mismatched chart histories and owns no numeric latest value", () => {
  const t = table([[cell("safe")]]), result = { plots: [], tables: [t], overlay: true, diagnostics: [], audit: { bars: 100 } };
  const adapted = pine.adaptPineChartResult(result, []);
  assert.equal(adapted.plots.length, 1); assert.equal(adapted.plots[0].kind, "table"); assert.equal(pine.latestPineChartPoint(adapted.plots[0]), null);
  assert.deepEqual(adapted.plots[0].segments, []); assert.equal(adapted.plots[0].table.tables[0], t);
  result.tables = []; assert.deepEqual(pine.adaptPineChartResult(result, []).plots, []);
});
test("table installation adds an empty no-autoscale host and disposes it exactly once", () => {
  const calls = [], chart = { addLineSeries(options) { calls.push(["options", options]); return { setData(data) { calls.push(["data", data]); }, attachPrimitive(p) { calls.push(["attach", p]); }, detachPrimitive(p) { calls.push(["detach", p]); } }; }, removeSeries(series) { calls.push(["remove", series]); } };
  const plot = pine.adaptPineChartResult({ plots: [], tables: [table([[cell("A")]])], overlay: true, diagnostics: [], audit: { bars: 0 } }, []).plots[0];
  const installed = pine.installPineChartPlots(chart, [plot]);
  assert.equal(installed.series.length, 1); assert.equal(calls[0][1].autoscaleInfoProvider(), null); assert.equal(calls[0][1].lineVisible, false); assert.deepEqual(calls[1], ["data", []]);
  installed.dispose(); installed.dispose(); assert.equal(calls.filter(c => c[0] === "detach").length, 1); assert.equal(calls.filter(c => c[0] === "remove").length, 1);
});
