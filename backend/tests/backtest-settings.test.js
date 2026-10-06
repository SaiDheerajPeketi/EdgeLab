import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-backtest-settings-"));
const output = path.join(directory, "model.mjs");
buildSync({ bundle: true, entryPoints: ["frontend/src/lib/backtestSettingsModel.ts"], format: "esm", outfile: output, platform: "node" });
const model = await import(pathToFileURL(output).href);
const draftOutput = path.join(directory, "drafts.mjs");
buildSync({ bundle: true, entryPoints: ["frontend/src/lib/journalDrafts.ts"], format: "esm", outfile: draftOutput, platform: "node" });
const drafts = await import(pathToFileURL(draftOutput).href);
test.after(() => fs.rmSync(directory, { force: true, recursive: true }));

test("Backtest numeric preferences reject blank, nonfinite and excessive risk without replacing edits", () => {
  for (const field of ["quantity", "riskPercent", "commissionFixed", "commissionPercent", "feeFixed", "feePercent"]) {
    for (const value of ["", " ", "NaN", "Infinity", "-1", false, 5]) assert.ok(model.backtestValidation(field, value), `${field}: ${value}`);
    assert.equal(model.backtestValidation(field, "0.125"), null);
  }
  assert.ok(model.backtestValidation("quantity", "0"));
  assert.ok(model.backtestValidation("riskPercent", "0"));
  for (const field of ["riskPercent", "commissionPercent", "feePercent"]) {
    assert.equal(model.backtestValidation(field, "100"), null);
    assert.ok(model.backtestValidation(field, "100.01"));
  }
  for (const field of ["commissionFixed", "feeFixed"]) assert.equal(model.backtestValidation(field, "0"), null);
  assert.equal(model.BACKTEST_DEFAULTS.lineConfirmation, true);
});

test("Backtest partial acknowledgment keeps failed, inactive and later return-to-original field edits", () => {
  const base = model.BACKTEST_DEFAULTS;
  const submitted = { ...base, quantity: "2500", commissionFixed: "3", feePercent: "0.5" };
  const edits = { quantity: base.quantity, commissionFixed: "3", feePercent: "invalid" };
  assert.deepEqual(drafts.restoreJournalDraft({ __schemaVersion: 1, value: edits }, submitted), edits);
  const remaining = drafts.acknowledgeJournalDraft(edits, submitted, ["commissionFixed"]);
  assert.deepEqual(remaining, { quantity: "100000", feePercent: "invalid" });
  assert.deepEqual(drafts.restoreJournalDraft({ __schemaVersion: 1, value: { sizingMode: "unknown" } }, base), {});
  assert.deepEqual(drafts.restoreJournalDraft({ __schemaVersion: 1, value: { quantity: "1".repeat(101) } }, base), {});
});
