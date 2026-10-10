import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = buildSync({ bundle: true, format: "cjs", platform: "node", packages: "external", write: false, logLevel: "silent", jsx: "automatic", stdin: {
  contents: 'export * from "./frontend/src/lib/indicatorPlotInspection.ts"; export * from "./frontend/src/components/chart/InteractiveIndicatorPlot.tsx"; export { formatChartDateTime } from "./frontend/src/lib/chartTimezones.ts";',
  loader: "tsx", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "indicator-pane-hover220.tsx",
} }).outputFiles[0].text;
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle)(createRequire(new URL("../../frontend/package.json", import.meta.url)), loaded, loaded.exports);
const { indicatorPlotReadouts, indicatorPlotSeriesPositions, indicatorPlotTimestamp, nearestIndicatorPlotPoint, formatIndicatorPlotValue, formatChartDateTime, InteractiveIndicatorPlot } = loaded.exports;
const points = [60, 120, 180, 240, 300].map((time, index) => ({ time, value: index + 1 }));
const series = [
  { label: "MACD", color: "#00ffff", digits: 5, data: points },
  { label: "Signal", color: "#ffff00", digits: 5, data: [{ time: 180, value: 15 }, { time: 300, value: 19 }] },
  { label: "Histogram", color: "#ff00ff", digits: 5, data: [{ time: 240, value: -7 }] },
];

test("MACD readouts match the selected primary bar time across unequal warmups and gaps", () => {
  const readouts = indicatorPlotReadouts(points, series);
  assert.deepEqual(readouts.map((point) => point.time), [60, 120, 180, 240, 300]);
  assert.deepEqual(readouts.map((point) => point.rows.map((row) => row.value)), [
    [1, null, null], [2, null, null], [3, 15, null], [4, null, -7], [5, 19, null],
  ]);
  assert.equal(formatIndicatorPlotValue(readouts[0].rows[1].value, 5), "—");
  assert.equal(formatIndicatorPlotValue(readouts[3].rows[2].value, 5), "-7.00000");
});

test("secondary MACD drawings occupy the same candle slots as their exact-time readouts", () => {
  const positions = indicatorPlotSeriesPositions(points, [...series[1].data, { time: 360, value: 20 }], 960);
  assert.deepEqual(positions.map(({ index, x }) => ({ index, x })), [{ index: 2, x: 480 }, { index: 4, x: 960 }]);
  assert.deepEqual(positions.map(({ point }) => point), series[1].data);
  const sameTimes = indicatorPlotSeriesPositions(points, points, 960);
  assert.deepEqual(sameTimes.map(({ x }) => x), [0, 240, 480, 720, 960]);
});

test("nearest plotted point remains exact across responsive widths, margins and viewport edges", () => {
  for (const width of [176, 390, 960, 1440]) {
    for (let index = 0; index < 160; index++) {
      assert.equal(nearestIndicatorPlotPoint(73 + index / 159 * width, 73, width, 160), index);
    }
    assert.equal(nearestIndicatorPlotPoint(-100, 73, width, 160), 0);
    assert.equal(nearestIndicatorPlotPoint(10000, 73, width, 160), 159);
  }
  assert.equal(nearestIndicatorPlotPoint(20, 0, 100, 1), 0);
  assert.equal(nearestIndicatorPlotPoint(20, 0, 0, 160), null);
  assert.equal(nearestIndicatorPlotPoint(NaN, 0, 100, 160), null);
  assert.equal(nearestIndicatorPlotPoint(20, 0, 100, 0), null);
});

test("indicator timestamps and format respect explicit chart timezone rather than browser defaults", () => {
  const time = Date.UTC(2026, 9, 10) / 1000;
  assert.equal(indicatorPlotTimestamp(time), Date.UTC(2026, 9, 10));
  assert.equal(indicatorPlotTimestamp("2026-10-10"), Date.UTC(2026, 9, 10));
  assert.equal(indicatorPlotTimestamp({ year: 2026, month: 10, day: 10 }), Date.UTC(2026, 9, 10));
  const settings = { timeZone: "UTC", dateFormat: "yyyy-MM-dd", timeHoursFormat: "24-hour", dayOfWeekLabels: false };
  assert.equal(formatChartDateTime(indicatorPlotTimestamp(time), settings), "2026-10-10 00:00");
  assert.equal(formatChartDateTime(indicatorPlotTimestamp(time), { ...settings, timeZone: "Asia/Kolkata" }), "2026-10-10 05:30");
  const aligned = indicatorPlotReadouts([{ time: "2026-10-10", value: 1 }], [{ ...series[0], data: [{ time: { year: 2026, month: 10, day: 10 }, value: 42 }] }]);
  assert.equal(aligned[0].rows[0].value, 42);
});

test("zero is a valid indicator value; non-finite or missing values remain unavailable", () => {
  assert.equal(formatIndicatorPlotValue(0, 5), "0.00000");
  for (const value of [null, NaN, Infinity, -Infinity]) assert.equal(formatIndicatorPlotValue(value, 5), "—");
  assert.equal(formatIndicatorPlotValue(49.123456, 1), "49.1");
  assert.equal(formatIndicatorPlotValue(-0.4321567, 5), "-0.43216");
  const invalid = indicatorPlotReadouts(points, [{ ...series[0], data: [{ time: 60, value: NaN }] }]);
  assert.ok(invalid.every((point) => point.rows[0].value === null));
});

test("interactive pane preserves original SVG geometry and exposes keyboard inspection without plot settings action", () => {
  const error = console.error;
  let html;
  console.error = (...args) => { if (!String(args[0]).includes("useLayoutEffect does nothing on the server")) error(...args); };
  try {
    html = renderToStaticMarkup(createElement(InteractiveIndicatorPlot, {
      className: "h-full", height: 96, label: "RSI 14", points, series: [series[0]],
      timeSettings: { timeZone: "UTC", dateFormat: "yyyy-MM-dd", timeHoursFormat: "24-hour", dayOfWeekLabels: false },
    }, createElement("path", { d: "M 0 28.8 L 960 28.8" })));
  } finally { console.error = error; }
  assert.match(html, /data-indicator-plot="RSI 14"/);
  assert.match(html, /aria-label="RSI 14 indicator values"/);
  assert.match(html, /role="group"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /viewBox="0 0 960 96"/);
  assert.match(html, /d="M 0 28.8 L 960 28.8"/);
  assert.match(html, /Home and End select the first and last plotted candle/);
  assert.match(html, /touch-pan-y/);
  assert.doesNotMatch(html, /<button/);
});
