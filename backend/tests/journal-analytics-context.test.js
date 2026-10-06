import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const bundle = buildSync({
  bundle: true, define: { "import.meta.env": "{}" }, format: "esm", logLevel: "silent",
  platform: "node", target: "node22", write: false,
  stdin: { contents: 'export { isJournalAnalyticsContext, JOURNAL_DIMENSIONS } from "./frontend/src/components/journal/useJournalAnalyticsContext.ts"; export { restoreSurfaceValue } from "./frontend/src/lib/useRestorableSurfaceState.ts"; export { DEFAULT_JOURNAL_FILTERS } from "./frontend/src/lib/journalAnalytics.ts";',
    loader: "ts", resolveDir: repoRoot, sourcefile: "journal-analytics-context-entry.ts" },
}).outputFiles[0].text;
const { isJournalAnalyticsContext, JOURNAL_DIMENSIONS, restoreSurfaceValue, DEFAULT_JOURNAL_FILTERS } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const initial = { filters: DEFAULT_JOURNAL_FILTERS, dimension: "market", selectedKey: null, drilling: false };
const schema = { version: 1, validate: isJournalAnalyticsContext };
const selected = {
  filters: { ...DEFAULT_JOURNAL_FILTERS, accountIds: [83081, 83082], tagIds: [91001],
    dateFrom: "2026-09-01", dateTo: "2026-09-30", direction: "SHORT", market: "Crypto", symbol: "BTCUSDT", strategy: "Patient setup", rating: "4" },
  dimension: "symbol", selectedKey: "BTCUSDT", drilling: true,
};
const restore = (value, version = 1) => restoreSurfaceValue({ __schemaVersion: version, value }, initial, schema);

test("shared analytics restoration preserves filters, selected segment and drilling for every supported dimension", () => {
  assert.equal(JOURNAL_DIMENSIONS.length, 12);
  for (const { id } of JOURNAL_DIMENSIONS) {
    const context = { ...selected, dimension: id };
    assert.equal(isJournalAnalyticsContext(context), true, id);
    assert.equal(restore(context), context, id);
  }
});

test("a valid empty analytics context restores without leaking a previous selected segment", () => {
  const context = structuredClone(initial);
  assert.equal(restore(context), context);
  assert.equal(context.selectedKey, null);
  assert.equal(context.drilling, false);
});

test("legacy, unknown version and malformed envelopes restore the safe initial context", () => {
  for (const value of [null, undefined, selected, { value: selected }, { __schemaVersion: 0, value: selected },
    { __schemaVersion: 2, value: selected }, { __schemaVersion: 1, value: null }]) {
    assert.equal(restoreSurfaceValue(value, initial, schema), initial);
  }
});

test("invalid date inputs cannot restore analytics filters", () => {
  for (const date of ["2026-02-30", "2026-13-01", "2026-09-00", "September 15", null, 20260915]) {
    for (const field of ["dateFrom", "dateTo"]) {
      assert.equal(restore({ ...selected, filters: { ...selected.filters, [field]: date } }), initial, `${field}:${date}`);
    }
  }
});

test("private account and tag identifiers require positive safe integer arrays", () => {
  for (const ids of ["83081", [0], [-1], [1.5], ["83081"], [Number.MAX_SAFE_INTEGER + 1], null]) {
    for (const field of ["accountIds", "tagIds"]) {
      assert.equal(restore({ ...selected, filters: { ...selected.filters, [field]: ids } }), initial, field);
    }
  }
});

test("unknown dimensions and invalid selected/drill fields reject the whole context", () => {
  for (const change of [{ dimension: "profit" }, { dimension: null }, { selectedKey: 83081 },
    { selectedKey: "x".repeat(1001) }, { drilling: "true" }, { drilling: null }]) {
    assert.equal(restore({ ...selected, ...change }), initial);
  }
});

test("invalid enum or unbounded text filters reject the whole restored context", () => {
  for (const [key, value] of [["direction", "BUY"], ["rating", "6"], ["rating", 4], ["market", null],
    ["symbol", "x".repeat(1001)], ["strategy", 123]]) {
    assert.equal(restore({ ...selected, filters: { ...selected.filters, [key]: value } }), initial, key);
  }
});
