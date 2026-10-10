import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = buildSync({ bundle: true, format: "cjs", platform: "node", packages: "external", write: false, logLevel: "silent", jsx: "automatic", stdin: {
  contents: 'export * from "./frontend/src/lib/journalEquityGeometry.ts"; export * from "./frontend/src/components/journal/JournalEquityPlot.tsx";',
  loader: "tsx", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "journal-chart-hover220.tsx",
} }).outputFiles[0].text;
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle)(createRequire(new URL("../../frontend/package.json", import.meta.url)), loaded, loaded.exports);
const { journalEquityGeometry, journalEquityPointIndex, JournalEquityPlot } = loaded.exports;
const points = [
  { date: "2026-10-01", tradeId: 31, value: 1050 },
  { date: "2026-10-01", tradeId: 32, value: 980 },
  { date: "2026-10-03", tradeId: 33, value: 1100 },
];

test("equity geometry preserves every trade and its currency-independent balance, including duplicate dates", () => {
  const result = journalEquityGeometry(points, 900, 224, 12);
  assert.deepEqual(result.map((point) => point.point), points);
  assert.equal(result[0].x, 12);
  assert.equal(result[2].x, 888);
  assert.equal(result[1].y, 212);
  assert.equal(result[2].y, 12);
  assert.ok(result[0].y > 12 && result[0].y < 212);
});

test("hover selects the same actual trade across responsive widths and clamps plot edges", () => {
  const geometry = journalEquityGeometry(points, 900, 224, 12);
  for (const renderedWidth of [280, 640, 1280]) {
    geometry.forEach((point, index) => assert.equal(journalEquityPointIndex(23 + point.x / 900 * renderedWidth, 23, renderedWidth, points.length, 900, 12), index));
    assert.equal(journalEquityPointIndex(-100, 23, renderedWidth, points.length, 900, 12), 0);
    assert.equal(journalEquityPointIndex(10000, 23, renderedWidth, points.length, 900, 12), 2);
  }
  assert.equal(journalEquityPointIndex(20, 0, 0, 3, 900, 12), null);
  assert.equal(journalEquityPointIndex(NaN, 0, 100, 3, 900, 12), null);
});

test("single and flat balances remain finite, centered and inspectable without invented points", () => {
  const single = journalEquityGeometry(points.slice(0, 1), 900, 224, 12);
  assert.deepEqual(single, [{ point: points[0], x: 450, y: 112 }]);
  assert.equal(journalEquityPointIndex(99, 0, 100, 1, 900, 12), 0);
  const flat = journalEquityGeometry(points.map((point) => ({ ...point, value: 42 })), 900, 80, 5);
  assert.deepEqual(flat.map((point) => point.y), [40, 40, 40]);
  assert.deepEqual(journalEquityGeometry([], 900, 224, 12), []);
  assert.deepEqual(journalEquityGeometry([{ ...points[0], value: Infinity }], 900, 224, 12), []);
});

test("chart retains accessible inspection and unique gradient ownership across account comparisons", () => {
  const html = renderToStaticMarkup(createElement("div", null,
    createElement(JournalEquityPlot, { points, currency: "INR", label: "First account balance" }),
    createElement(JournalEquityPlot, { points: points.slice(0, 1), currency: "USD", label: "Second account balance", compact: true }),
  ));
  assert.match(html, /aria-label="First account balance"/);
  assert.match(html, /aria-label="Second account balance"/);
  assert.equal((html.match(/data-journal-equity-chart="true"/g) ?? []).length, 2);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 2);
  assert.match(html, /Home and End select the first and last trade/);
  assert.match(html, /preserveAspectRatio="none"/);
  assert.match(html, /touch-pan-y/);
  const gradients = [...html.matchAll(/linearGradient id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(gradients).size, 2);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("empty journal chart exposes an honest empty state", () => {
  const html = renderToStaticMarkup(createElement(JournalEquityPlot, { points: [], currency: "USD" }));
  assert.match(html, /Close trades to build the equity curve/);
  assert.doesNotMatch(html, /data-journal-equity-chart|<path/);
});
