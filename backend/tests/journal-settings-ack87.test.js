import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
const bundle = buildSync({ entryPoints: ["frontend/src/lib/journalSettingsModel.ts"], bundle: true, write: false, format: "esm", logLevel: "silent" }).outputFiles[0].text;
const model = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const item = (value, key = "live-journal.v1") => ({ namespace: "edgelab", key, value });

test("missing read values use defaults while legacy records and unknown settings remain untouched", () => {
  assert.deepEqual(model.confirmedJournalSettings(item(null)), model.DEFAULT_JOURNAL_SETTINGS);
  for (const value of [{}, { trades: [{ id: "private" }], settings: null }, { settings: { future_setting: { kept: true }, default_currency: "eur", default_broker: "  Desk  " } }]) {
    const before = structuredClone(value), actual = model.confirmedJournalSettings(item(value));
    assert.equal(actual.default_currency, value.settings?.default_currency ? "EUR" : "USD");
    assert.deepEqual(value, before);
  }
});
test("malformed response envelopes and recoverable corrupted journal data reject before publication", () => {
  for (const response of [null, [], {}, { ...item(null), namespace: "other" }, item(null, "wrong-key"), { namespace: "edgelab", key: "live-journal.v1" }]) assert.throws(() => model.confirmedJournalSettings(response), /confirmed/);
  for (const value of [[], "legacy", { settings: [] }, { settings: "legacy" }, { settings: { default_broker: "x".repeat(81) } }, { settings: { default_currency: "U1" } }, { settings: { default_entry_type: "other" } }, { settings: { require_account_for_taken_trades: 1 } }]) assert.throws(() => model.confirmedJournalSettings(item(value)), /recovery/);
});
test("journal acknowledgments require every changed field and its canonical value", () => {
  const changes = { default_currency: "EUR", require_account_for_taken_trades: false };
  assert.deepEqual(model.confirmedJournalSettings(item({ settings: { ...model.DEFAULT_JOURNAL_SETTINGS, ...changes } }), changes), { ...model.DEFAULT_JOURNAL_SETTINGS, ...changes });
  for (const value of [null, {}, { settings: {} }, { settings: model.DEFAULT_JOURNAL_SETTINGS }, { settings: { default_currency: "EUR" } }]) assert.throws(() => model.confirmedJournalSettings(item(value), changes), /not confirmed/);
  assert.throws(() => model.confirmedJournalSettings(item({}), { default_broker: "" }), /not confirmed/, "An absent field must not pass just because its fallback matches");
  assert.equal(model.confirmedJournalSettings(item({ settings: { default_broker: "Manual" } }), { default_broker: "  " }).default_broker, "Manual");
  assert.equal(model.confirmedJournalSettings(item({ settings: { default_broker: "Desk" } }), { default_broker: "  Desk  " }).default_broker, "Desk");
});
test("note acknowledgments preserve multiline unicode bytes and reject substituted fallback success", () => {
  const text = "  Before: {entry}\r\nAfter: {exit}  🎯\n\n";
  assert.equal(model.confirmedNoteTemplate(item(null, "notebook-template.v1")), model.DEFAULT_NOTE_TEMPLATE);
  assert.equal(model.confirmedNoteTemplate(item(text, "notebook-template.v1"), text), text);
  for (const value of [null, [], {}, "", "  ", text.trim(), "Other note", "x".repeat(200_001)]) assert.throws(() => model.confirmedNoteTemplate(item(value, "notebook-template.v1"), text), /confirmed/);
  assert.throws(() => model.confirmedNoteTemplate(item(text)), /confirmed/);
});
