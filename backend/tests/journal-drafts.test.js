import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-journal-drafts-"));
const output = path.join(directory, "module.mjs");
buildSync({ bundle: true, entryPoints: [path.join(root, "frontend/src/lib/journalDrafts.ts")], format: "esm", outfile: output, platform: "node" });
const drafts = await import(pathToFileURL(output).href);
const mutationOutput = path.join(directory, "mutations.mjs");
buildSync({ bundle: true, entryPoints: [path.join(root, "frontend/src/lib/journalMutationState.ts")], format: "esm", outfile: mutationOutput, platform: "node" });
const mutations = await import(pathToFileURL(mutationOutput).href);
test.after(() => fs.rmSync(directory, { force: true, recursive: true }));

const trade = {
  reviewed: false, rating: null, setup_grade: null, tags: [],
  entry_time: "2026-09-15T09:00:47.123Z", exit_time: "2026-09-15T10:00:59.888Z",
  entry_price: "100.1250", exit_price: "110.0000", stop_loss: null, take_profit: null,
  strategy_name: "Original strategy", emotional_state: null,
  notes: [{ id: 1, body: "Already saved note" }], screenshots: [],
};

test("journal drafts reject obsolete, malformed, and unknown fields without restoring private garbage", () => {
  const base = drafts.journalReviewDraft(trade);
  for (const stored of [null, [], { __schemaVersion: 0, value: { note: "old" } },
    { __schemaVersion: 1, value: { note: 7 } }, { __schemaVersion: 1, value: { reviewed: "false" } },
    { __schemaVersion: 1, value: { rating: 6 } }, { __schemaVersion: 1, value: { setupGrade: "Z" } },
    { __schemaVersion: 1, value: { tagIds: [-1] } }, { __schemaVersion: 1, value: { token: "never store credentials" } },
    { __schemaVersion: 1, value: JSON.parse('{"__proto__":{"note":"injected"}}') },
  ]) assert.deepEqual(drafts.restoreJournalDraft(stored, base), {});
  const edits = { note: "🌍 مراجعة", rating: 4, setupGrade: "D", tagIds: [2, 7], reviewed: true };
  assert.deepEqual(drafts.restoreJournalDraft({ __schemaVersion: 1, value: edits }, base), edits);
  assert.deepEqual(drafts.restoreJournalDraft({ __schemaVersion: 1, value: { initialBalance: "125.50", color: "#abcdef" } }, drafts.emptyJournalAccountDraft()), { initialBalance: "125.50", color: "#abcdef" });
});

test("restored review edits leave untouched canonical execution and metadata current", () => {
  const base = drafts.journalReviewDraft(trade);
  const edits = drafts.journalDraftEdits(base, { ...base, note: "Pending note", strategy: "Pending strategy" });
  assert.deepEqual(edits, { strategy: "Pending strategy", note: "Pending note" });
  const refreshed = drafts.journalReviewDraft({ ...trade, reviewed: true, entry_price: "205.7500", rating: 5 });
  const restored = { ...refreshed, ...drafts.restoreJournalDraft({ __schemaVersion: 1, value: edits }, refreshed) };
  assert.equal(restored.entryPrice, "205.7500");
  assert.equal(restored.rating, 5);
  assert.equal(restored.reviewed, true);
  assert.deepEqual(drafts.journalReviewPayload(refreshed, restored), { strategy_name: "Pending strategy", note: "Pending note" });
});

test("metadata review PATCH preserves timestamps, exact prices, tags and existing append-only notes", () => {
  const base = drafts.journalReviewDraft(trade);
  assert.equal(base.note, "");
  assert.deepEqual(drafts.journalReviewPayload(base, base), {});
  assert.deepEqual(drafts.journalReviewPayload(base, { ...base, reviewed: true, rating: 4, note: "  New note  " }), { reviewed: true, rating: 4, note: "New note" });
  assert.deepEqual(drafts.journalReviewPayload(base, { ...base, entryPrice: "150.125", exitTime: "", exitPrice: "", screenshotUrls: "https://example.test/one.png\nhttps://example.test/two.png", tagIds: [9] }), {
    entry_price: 150.125, exit_price: null, exit_time: null, tag_ids: [9],
    screenshot_urls: ["https://example.test/one.png", "https://example.test/two.png"],
  });
});

test("partial acknowledgement retains hidden edits and a late save retains newer field revisions", () => {
  const base = drafts.journalReviewDraft(trade);
  const submitted = { ...base, reviewed: true, rating: 4, setupGrade: "A+", note: "Submitted note", strategy: "Pending strategy" };
  const edits = drafts.journalDraftEdits(base, submitted);
  const partial = drafts.acknowledgeJournalDraft(edits, submitted, ["reviewed", "rating", "setupGrade", "note"]);
  assert.deepEqual(partial, { strategy: "Pending strategy" });
  assert.deepEqual(drafts.acknowledgeJournalDraft({ ...edits, note: "Newer note", rating: 5 }, submitted), { note: "Newer note", rating: 5 });
  assert.deepEqual(drafts.acknowledgeJournalDraft(edits, submitted), {});
  assert.equal(edits.note, "Submitted note");
  const account = drafts.emptyJournalAccountDraft();
  const accountSubmission = { ...account, name: "Submitted account", notes: "Submitted notes" };
  assert.deepEqual(drafts.acknowledgeJournalDraft({ name: "Newer account", notes: "Submitted notes" }, accountSubmission), { name: "Newer account" });
});

test("pending Journal mutations prevent duplicate work per owner and release the guard after failure", async () => {
  let identity = 1;
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ token: "test", expiresAt: "2099-01-01T00:00:00Z", user: { id: identity, email: `user${identity}@example.test` } }) } };
  let release;
  let calls = 0;
  const held = mutations.runJournalMutation("journal:account-create", () => { calls += 1; return new Promise((resolve) => { release = resolve; }); });
  try {
    await assert.rejects(mutations.runJournalMutation("journal:account-create", async () => { calls += 1; }), /already in progress/);
    assert.equal(calls, 1);
    identity = 2;
    assert.equal(await mutations.runJournalMutation("journal:account-create", async () => "other owner"), "other owner");
    identity = 1;
    await assert.rejects(mutations.runJournalMutation("journal:account-create", async () => "duplicate"), /already in progress/);
    release("saved");
    assert.equal(await held, "saved");
    await assert.rejects(mutations.runJournalMutation("journal:account-create", async () => { throw new Error("server failure"); }), /server failure/);
    assert.equal(await mutations.runJournalMutation("journal:account-create", async () => "retry saved"), "retry saved");
  } finally { release?.("saved"); delete globalThis.window; }
});
