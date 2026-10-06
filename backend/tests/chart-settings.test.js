import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-chart-settings-"));
const output = path.join(directory, "model.mjs");
buildSync({ bundle: true, entryPoints: ["frontend/src/lib/chartSettingsDraft.ts"], format: "esm", outfile: output, platform: "node" });
const model = await import(pathToFileURL(output).href);
test.after(() => fs.rmSync(directory, { force: true, recursive: true }));

test("Chart text sizes accept only the consumer's integer range while keeping raw edits", () => {
  for (const textSize of ["", " ", "NaN", "Infinity", "9", "18.1", "19", "-1"]) assert.ok(model.chartDraftValidation({ ...model.DEFAULT_CHART_DRAFT, textSize }));
  for (const textSize of ["10", "12", "18"]) assert.equal(model.chartDraftValidation({ ...model.DEFAULT_CHART_DRAFT, textSize }), null);
});

test("Queued chart snapshots preserve later edits and deletions while adopting acknowledged settings and metadata", () => {
  const before = [{ name: "Settings default", settings: { textSize: 12, gridMode: "both", future: "keep" }, updatedAt: "old", futureMetadata: { version: 1 } }, { name: "Deleted", settings: { textSize: 13 } }];
  const confirmed = [{ ...before[0], settings: { ...before[0].settings, textSize: 16 }, updatedAt: "ack", futureMetadata: { version: 2 } }, before[1], { name: "Remote new", settings: { textSize: 14 } }];
  const pending = [{ ...before[0], settings: { ...before[0].settings, gridMode: "none" } }, { name: "Later new", settings: { textSize: 18 } }];
  const result = model.rebaseQueuedChartPresets(pending, confirmed, before);
  assert.deepEqual(result[0], { ...confirmed[0], settings: { textSize: 16, gridMode: "none", future: "keep" } });
  assert.deepEqual(result.slice(1), [pending[1], confirmed[2]]);
  assert.deepEqual(before[0].settings, { textSize: 12, gridMode: "both", future: "keep" });
});

test("Queued preference snapshots retain unknown server fields and explicit return-to-original changes", () => {
  assert.deepEqual(model.rebaseQueuedPreferences({ density: "comfortable", includeDiagnosticsByDefault: true }, { density: "compact", includeDiagnosticsByDefault: false, future: 5 }, { density: "compact", includeDiagnosticsByDefault: true }), { density: "comfortable", includeDiagnosticsByDefault: false, future: 5 });
});
