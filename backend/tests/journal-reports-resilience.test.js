import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

async function bundle(relativePath) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-journal-locale-"));
  const output = path.join(directory, "module.mjs");
  buildSync({ bundle: true, entryPoints: [path.join(root, relativePath)], format: "esm", outfile: output, platform: "node" });
  return { cleanup: () => fs.rmSync(directory, { force: true, recursive: true }), module: await import(`${pathToFileURL(output).href}?${Date.now()}`) };
}

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
  assert.match(source, /label: "profit"/);
  assert.match(source, /label: "loss"/);
  assert.match(source, /label: "breakeven"/);
  assert.doesNotMatch(source, /toLocale(?:Date|Time|String)/);
});

test("daily note list and trade actions retain touch-sized targets", () => {
  const source = read("frontend/src/components/journal/JournalNotesSurface.tsx");
  assert.ok((source.match(/min-h-\[var\(--control-height\)\]/g) ?? []).length >= 2);
});

test("shared Journal summary formatting uses fraction semantics in en-US and de-DE", async () => {
  const { cleanup, module } = await bundle("frontend/src/lib/locale.ts");
  try {
    assert.equal(module.formatLocaleNumber(1234, {}, "en-US"), "1,234");
    assert.equal(module.formatLocaleNumber(1234, {}, "de-DE"), "1.234");
    assert.equal(module.formatMetricPercent(0.625, "en-US"), "62.5%");
    assert.equal(module.formatMetricPercent(0.625, "de-DE"), "62,5 %");
  } finally { cleanup(); }
});

test("zero Journal P&L is exposed as neutral breakeven, not profit", async () => {
  const { cleanup, module } = await bundle("frontend/src/components/journal/JournalNotesSurface.tsx");
  try {
    assert.deepEqual(module.tradeResultState(42), { label: "profit", sign: "+", tone: "text-[var(--profit-text)]" });
    assert.deepEqual(module.tradeResultState(-42), { label: "loss", sign: "−", tone: "text-[var(--loss-text)]" });
    assert.deepEqual(module.tradeResultState(0), { label: "breakeven", sign: "=", tone: "text-[var(--text-secondary)]" });
  } finally { cleanup(); }
});

test("daily note summary renders counts and percentages through locale helpers", () => {
  const source = read("frontend/src/components/journal/JournalNotesSurface.tsx");
  assert.match(source, /formatLocaleNumber\(dayTrades\.length\)/);
  assert.match(source, /formatMetricPercent\(summary\.winRate \/ 100\)/);
  assert.match(source, /formatMetricPercent\(summary\.reviewedPercent \/ 100\)/);
  assert.match(source, /resultState\.label/);
  assert.match(source, /resultState\.sign/);
});
