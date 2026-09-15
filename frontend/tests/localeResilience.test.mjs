import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  formatLocaleCurrency,
  formatLocaleDateTime,
  formatLocaleNumber,
  interfaceLocale,
} from "../src/lib/locale.ts";

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

test("invalid locale identifiers fall back for every formatter", () => {
  const invalidLocale = "not_a_locale_%%%";

  assert.equal(interfaceLocale(invalidLocale), undefined);
  assert.doesNotThrow(() => formatLocaleNumber(1234567.89, {}, invalidLocale));
  assert.doesNotThrow(() => formatLocaleNumber(0.425, { style: "percent" }, invalidLocale));
  assert.doesNotThrow(() => formatLocaleCurrency(1234567.89, "EUR", {}, invalidLocale));
  assert.doesNotThrow(() => formatLocaleDateTime("2026-09-16T08:30:00Z", {}, invalidLocale));

  assert.notEqual(formatLocaleNumber(1234567.89, {}, invalidLocale), "");
  assert.match(formatLocaleCurrency(1234567.89, "EUR", {}, invalidLocale), /[\d,.\s]+/);
  assert.notEqual(formatLocaleDateTime("2026-09-16T08:30:00Z", {}, invalidLocale), "—");
});

test("locale lists retain valid fallbacks when another entry is malformed", () => {
  assert.deepEqual(interfaceLocale(["invalid_%%%", "de-DE"]), ["de-DE"]);
  assert.equal(formatLocaleNumber(1234.5, { minimumFractionDigits: 1 }, ["invalid_%%%", "de-DE"]), "1.234,5");
});

test("high-traffic financial surfaces use shared locale formatting and logical alignment", async () => {
  const files = await Promise.all([
    read("components/MetricsBar.tsx"),
    read("components/PositionPanel.tsx"),
    read("components/EquityCurve.tsx"),
    read("components/ExecutionTape.tsx"),
    read("components/charts/heatmap/heatmap-utils.ts"),
    read("components/charts/heatmap/heatmap-x-axis.tsx"),
  ]);
  for (const source of files) {
    assert.doesNotMatch(source, /Intl\.(?:NumberFormat|DateTimeFormat)\("en-US"/);
  }
  assert.match(files[0], /formatLocaleCurrency/);
  assert.match(files[0], /ui-number/);
  assert.match(files[1], /border-e/);
  assert.match(files[3], /formatLocaleDateTime/);
  assert.match(files[4], /formatLocaleNumber/);
  assert.match(files[5], /formatLocaleDateTime/);
});
