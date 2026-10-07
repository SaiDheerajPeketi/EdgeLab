import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = buildSync({ bundle: true, format: "cjs", platform: "node", packages: "external", write: false, logLevel: "silent", jsx: "automatic", stdin: {
  contents: 'export * from "./frontend/src/lib/pineChartNotices.ts"; export * from "./frontend/src/components/PineChartNotices.tsx";',
  loader: "tsx", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "pine-chart-notices-oracle.tsx",
} }).outputFiles[0].text;
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle)(createRequire(import.meta.url), loaded, loaded.exports);
const { groupPineChartNotices, PineChartNotices } = loaded.exports;
const diagnostic = (code, message = code, fields = {}) => ({ code, message, severity: "warning", line: 1, column: 1, ...fields });
const assumptions = ["CLOSED_BAR_SNAPSHOT", "SNAPSHOT_CONTEXT", "DEFAULT_SYMBOL_METADATA"].map((code) => diagnostic(code));
const study = (id, name, diagnostics = assumptions, adapterWarnings = []) => ({ id, name, diagnostics, adapterWarnings });
const frozen = (object) => { Object.freeze(object); for (const value of Object.values(object)) if (value && typeof value === "object" && !Object.isFrozen(value)) frozen(value); return object; };

test("shared native assumptions appear once while every affected identity remains attributable", () => {
  const input = Array.from({ length: 17 }, (_, i) => study("script-" + i, "Source " + i));
  const grouped = groupPineChartNotices(input);
  assert.equal(grouped.assumptions.length, 3);
  assert.deepEqual(grouped.warnings, []);
  for (const group of grouped.assumptions) {
    assert.deepEqual(group.sources, input.map(({ id, name }) => ({ id, name })));
    assert.deepEqual(group.diagnostic, assumptions.find((entry) => entry.code === group.diagnostic.code));
  }
});
test("sharing uses full diagnostic identity rather than a matching code or message fragment", () => {
  const base = diagnostic("SNAPSHOT_CONTEXT", "Exact snapshot");
  const variants = [base, { ...base, message: "Other snapshot" }, { ...base, line: 2 }, { ...base, column: 2 },
    { ...base, code: "CLOSED_BAR_SNAPSHOT" }, { ...base, severity: "info" }, { ...base, severity: "error" }];
  const grouped = groupPineChartNotices(variants.map((value, i) => study("id-" + i, "Source " + i, [value])));
  assert.equal(grouped.assumptions.length, 5);
  for (const group of grouped.assumptions) assert.equal(group.sources.length, 1);
  assert.deepEqual(grouped.warnings.map((entry) => entry.id), ["id-5", "id-6"]);
});
test("duplicate names retain separate script IDs and repeated same-source assumptions remain bounded", () => {
  const grouped = groupPineChartNotices([study("first", "Duplicate", [...assumptions, ...assumptions]), study("second", "Duplicate")]);
  assert.equal(grouped.assumptions.length, 3);
  for (const group of grouped.assumptions) assert.deepEqual(group.sources, [{ id: "first", name: "Duplicate" }, { id: "second", name: "Duplicate" }]);
});
test("adapter warnings resembling assumptions and unknown diagnostic codes stay visibly scoped to their script", () => {
  const identical = "CLOSED_BAR_SNAPSHOT: " + assumptions[0].message;
  const input = [study("a", "Alpha", [...assumptions, diagnostic("UNSUPPORTED_BACKGROUND", "Background plot absent")], [identical, "Shape Buy uses local metrics"]),
    study("b", "Beta", [...assumptions, diagnostic("ALERT_DELIVERY_UNAVAILABLE", "Alerts are not delivered")], ["Plot Offset is not drawn"])];
  const grouped = groupPineChartNotices(input);
  assert.deepEqual(grouped.warnings, [
    { id: "a", name: "Alpha", messages: ["UNSUPPORTED_BACKGROUND: Background plot absent", identical, "Shape Buy uses local metrics"] },
    { id: "b", name: "Beta", messages: ["ALERT_DELIVERY_UNAVAILABLE: Alerts are not delivered", "Plot Offset is not drawn"] },
  ]);
  assert.equal(grouped.assumptions.length, 3);
});
test("filtered or removed studies cannot leave stale sources and grouping never mutates frozen input", () => {
  const input = frozen([study("a", "Alpha"), study("b", "Beta"), study("c", "Gamma", [], ["Warning"])]), before = structuredClone(input);
  const all = groupPineChartNotices(input), one = groupPineChartNotices(input.filter((entry) => entry.id === "b"));
  assert.ok(all.assumptions.every((group) => group.sources.length === 2));
  assert.ok(one.assumptions.every((group) => group.sources.length === 1 && group.sources[0].id === "b"));
  assert.deepEqual(groupPineChartNotices([]), { assumptions: [], warnings: [] });
  assert.deepEqual(input, before);
});
test("real notice markup gives one keyboard disclosure and keeps distinct warnings outside its closed body", () => {
  const inputs = [study("a", "Alpha <source>"), study("b", "Beta", assumptions, ["Buy label unsupported"]), study("c", "Gamma", [diagnostic("ALERT_DELIVERY_UNAVAILABLE", "Alerts unavailable")])];
  const html = renderToStaticMarkup(createElement(PineChartNotices, { studies: inputs }));
  assert.equal((html.match(/<details/g) ?? []).length, 1);
  assert.equal((html.match(/aria-label="Pine execution assumptions"/g) ?? []).length, 1);
  assert.ok(html.includes("Closed historical snapshot · 3 assumptions · 2 scripts"));
  assert.ok(html.includes('aria-label="Assumption details and affected scripts"'));
  assert.ok(html.includes('tabindex="0"')); assert.ok(!html.includes("<details open"));
  assert.ok(html.includes("Alpha &lt;source&gt;")); assert.ok(!html.includes("<source>"));
  const shared = html.slice(html.indexOf("<details"));
  assert.ok(!shared.includes("Buy label unsupported")); assert.ok(!shared.includes("Alerts unavailable"));
  assert.ok(html.indexOf("Beta:") < html.indexOf("<details")); assert.ok(html.indexOf("Gamma:") < html.indexOf("<details"));
  assert.equal((html.match(/role="status"/g) ?? []).length, 3);
});
test("no notices renders no empty status; a single exact source uses singular provenance", () => {
  assert.equal(renderToStaticMarkup(createElement(PineChartNotices, { studies: [] })), "");
  const html = renderToStaticMarkup(createElement(PineChartNotices, { studies: [study("only", "One")] }));
  assert.ok(html.includes("3 assumptions · 1 script")); assert.ok(!html.includes("1 scripts"));
});

test("live informational details never label the running chart as a closed snapshot", () => {
  const live = study("live", "Live study", [diagnostic("REALTIME_CONTEXT"), diagnostic("REALTIME_STATE_BOUNDS"), diagnostic("DEFAULT_SYMBOL_METADATA")]);
  const grouped = groupPineChartNotices([live]);
  assert.equal(grouped.assumptions.length, 3);
  assert.deepEqual(grouped.warnings, []);
  const html = renderToStaticMarkup(createElement(PineChartNotices, { studies: [live] }));
  assert.ok(html.includes("Live chart updates · 3 assumptions · 1 script"));
  assert.ok(!html.includes("Closed historical snapshot"));
  for (const item of live.diagnostics) assert.ok(html.slice(html.indexOf("<details")).includes(item.code));
  const mixed = renderToStaticMarkup(createElement(PineChartNotices, { studies: [live, study("closed", "Strategy")] }));
  assert.ok(mixed.includes("Pine execution details"));
  const metadata = renderToStaticMarkup(createElement(PineChartNotices, { studies: [study("meta", "Metadata", [diagnostic("DEFAULT_SYMBOL_METADATA")])] }));
  assert.ok(metadata.includes("Pine execution details"));
});

test("live execution failures and unsupported capabilities remain outside the disclosure", () => {
  const html = renderToStaticMarkup(createElement(PineChartNotices, { studies: [study("live", "Live study", [diagnostic("REALTIME_CONTEXT"), diagnostic("REALTIME_STATE_LIMIT", "Session halted", { severity: "error" }), diagnostic("ALERT_DELIVERY_UNAVAILABLE", "Alerts unavailable")], ["Drawing unavailable"])] }));
  const visible = html.slice(0, html.indexOf("<details"));
  assert.ok(visible.includes("Session halted"));
  assert.ok(visible.includes("Alerts unavailable"));
  assert.ok(visible.includes("Drawing unavailable"));
});
