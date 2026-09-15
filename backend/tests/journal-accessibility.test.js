import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Journal controls inherit density-aware touch targets and visible keyboard focus", () => {
  const controls = read("frontend/src/components/journal/JournalControls.tsx");
  assert.match(controls, /min-h-\[var\(--control-height\)\]/);
  assert.match(controls, /has-\[:focus-visible\]:ring-2/);
  assert.doesNotMatch(controls, /min-h-(?:8|10)\b/);
});

test("trade review drawer exposes its context, state, and execution table semantics", () => {
  const drawer = read("frontend/src/components/journal/JournalReviewDrawer.tsx");
  assert.match(drawer, /ariaDescribedBy=\{descriptionId\}/);
  assert.match(drawer, /aria-label="Trade reviewed"/);
  assert.match(drawer, /Reviewed <span[^>]*>\(\{draft\.reviewed \? "yes" : "no"\}\)<\/span>/);
  assert.match(drawer, /aria-live="polite"/);
  assert.match(drawer, /<caption className="sr-only">Raw fills and executions retained for this trade<\/caption>/);
  assert.equal((drawer.match(/<th scope="col"/g) ?? []).length, 5);
  assert.match(drawer, /safe-area-inset-bottom/);
});

test("trade review compact actions retain coarse-pointer target sizing", () => {
  const drawer = read("frontend/src/components/journal/JournalReviewDrawer.tsx");
  assert.match(drawer, /h-\[var\(--control-height\)\] w-\[var\(--control-height\)\]/);
  assert.match(drawer, /min-h-\[var\(--control-height\)\] items-center gap-1/);
  assert.doesNotMatch(drawer, /(?:min-h|h)-(?:8|10)\b/);
});
