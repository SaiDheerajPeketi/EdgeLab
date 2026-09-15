import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../src/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("shared formatting follows the interface locale without a US-only fallback", async () => {
  const [format, locale] = await Promise.all([read("lib/format.ts"), read("lib/locale.ts")]);
  assert.doesNotMatch(format, /Intl\.NumberFormat\("en-US"/);
  assert.match(format, /formatLocaleCurrency/);
  assert.match(locale, /document\.documentElement\.lang/);
  assert.match(locale, /Intl\.DateTimeFormat/);
  assert.match(locale, /Number\.isFinite/);
});

test("shared controls tolerate long and bidirectional copy", async () => {
  const [styles, settings, journal] = await Promise.all([
    read("styles.css"),
    read("components/settings/SettingsPrimitives.tsx"),
    read("components/journal/JournalControls.tsx"),
  ]);
  assert.match(styles, /\.ui-resilient-text[\s\S]*overflow-wrap: anywhere/);
  assert.match(styles, /unicode-bidi: isolate/);
  assert.match(styles, /\[dir="rtl"\]/);
  assert.match(styles, /font-size: max\(1rem, 1em\)/);
  assert.match(settings, /dir="auto"/);
  assert.match(settings, /min-w-0/);
  assert.match(journal, /text-start/);
});
