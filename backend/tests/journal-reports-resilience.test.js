import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("reports use the shared locale contract and isolate dynamic bidirectional text", () => {
  const source = read("frontend/src/components/ReportsPanel.tsx");
  for (const helper of ["formatLocaleCurrency", "formatLocaleDateTime", "formatLocaleNumber", "formatMetricPercent", "formatMetricRatio"]) assert.ok(source.includes(helper));
  assert.doesNotMatch(source, /toLocaleString\(|new Intl\./);
  assert.match(source, /<bdi>/);
  assert.match(source, /<time dateTime=\{day\.date\}/);
  assert.match(source, /auto-fit/);
  assert.doesNotMatch(source, /min-w-\[42rem\]/);
});

test("daily notes support logical direction, locale formatting, and non-color outcomes", () => {
  const source = read("frontend/src/components/journal/JournalNotesSurface.tsx");
  assert.match(source, /start-3/);
  assert.match(source, /ps-9/);
  assert.match(source, /text-start/);
  assert.match(source, /rtl:rotate-180/);
  assert.match(source, /formatLocaleDateTime/);
  assert.match(source, /formatLocaleCurrency/);
  assert.match(source, /Profit/);
  assert.match(source, /Loss/);
  assert.doesNotMatch(source, /toLocale(?:Date|Time|String)/);
});

test("daily note list and trade actions retain touch-sized targets", () => {
  const source = read("frontend/src/components/journal/JournalNotesSurface.tsx");
  assert.ok((source.match(/min-h-\[var\(--control-height\)\]/g) ?? []).length >= 2);
});
