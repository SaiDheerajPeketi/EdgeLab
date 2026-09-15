import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function bundle(relativePath) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-shared-control-"));
  const output = path.join(directory, "module.mjs");
  buildSync({ bundle: true, entryPoints: [path.join(root, relativePath)], format: "esm", outfile: output, platform: "node" });
  return { cleanup: () => fs.rmSync(directory, { force: true, recursive: true }), module: await import(`${pathToFileURL(output).href}?${Date.now()}`) };
}

test("shared slider exposes explicit localized value text", async () => {
  const { cleanup, module } = await bundle("frontend/src/components/ui/Primitives.tsx");
  try {
    const previousDocument = globalThis.document;
    globalThis.document = { documentElement: { lang: "de-DE" } };
    assert.equal(module.sliderValueText(1234.5, " ms"), "1.234,5 ms");
    globalThis.document = previousDocument;
  } finally { cleanup(); }
});

test("shared selection controls enforce touch, focus, locale, and long-label contracts", () => {
  const source = fs.readFileSync(path.join(root, "frontend/src/components/ui/Primitives.tsx"), "utf8");
  const toggle = source.match(/export function Toggle[\s\S]*?^}/m)?.[0] ?? "";
  const radio = source.match(/export function RadioGroup[\s\S]*?^}/m)?.[0] ?? "";
  const slider = source.match(/export function Slider[\s\S]*?^}/m)?.[0] ?? "";
  const segmented = source.match(/export function SegmentedControl[\s\S]*?^}/m)?.[0] ?? "";
  assert.match(toggle, /min-h-\[var\(--control-height\)\]/);
  assert.match(toggle, /aria-label=\{label\}/);
  assert.match(toggle, /aria-checked=\{checked\}/);
  assert.doesNotMatch(toggle, /["'](?:on|off)["']/);
  assert.match(radio, /const groupName = useId\(\)/);
  assert.match(radio, /name=\{groupName\}/);
  assert.match(radio, /has-\[:focus-visible\]:ring-2/);
  assert.match(radio, /break-words/);
  assert.match(slider, /aria-valuetext=\{valueText\}/);
  assert.match(slider, /min-h-\[var\(--control-height\)\]/);
  assert.match(segmented, /min-h-\[var\(--control-height\)\]/);
  assert.doesNotMatch(segmented, /min-h-8/);
});
