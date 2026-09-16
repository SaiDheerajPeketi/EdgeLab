import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const assetRoot = path.join(root, "frontend/dist/assets");
const manifestPath = path.join(root, "frontend/dist/.vite/manifest.json");
const budget = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-performance-budgets.json"), "utf8"));
const exceptions = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-performance-exceptions.json"), "utf8"));
assert.ok(fs.existsSync(assetRoot), "Build frontend before checking UI performance budgets.");
assert.ok(fs.existsSync(manifestPath), "Vite manifest is required to measure route dependency graphs.");

const assets = fs.readdirSync(assetRoot).map((name) => ({
  name,
  bytes: fs.statSync(path.join(assetRoot, name)).size,
  gzipBytes: gzipSync(fs.readFileSync(path.join(assetRoot, name))).byteLength,
}));
const assetByFile = new Map(assets.map((asset) => [`assets/${asset.name}`, asset]));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];
for (const asset of assets) {
  let limit = budget.rawBytes.routeChunk;
  if (/^index-.*\.js$/.test(asset.name)) limit = budget.rawBytes.initialEntry;
  else if (/TradingChart|chart-vendor/.test(asset.name)) limit = budget.rawBytes.chartChunk;
  else if (/\.css$/.test(asset.name)) limit = budget.rawBytes.stylesheet;
  else if (/\.woff2?$/.test(asset.name)) limit = budget.rawBytes.font;
  else if (/\.(png|jpe?g|webp|avif)$/.test(asset.name)) limit = budget.rawBytes.image;
  if (asset.bytes > limit) failures.push(`${asset.name}: ${asset.bytes} > ${limit} raw bytes`);
}

function moduleForSource(fragment) {
  const requestedName = path.basename(fragment, path.extname(fragment));
  const matches = Object.entries(manifest).filter(([source, item]) =>
    source.endsWith(fragment) || item.src?.endsWith(fragment) || item.name === fragment || item.name === requestedName,
  );
  assert.equal(matches.length, 1, `Expected exactly one manifest module ending in ${fragment}.`);
  return matches[0];
}

function dependencyFiles(source, seen = new Set()) {
  if (seen.has(source)) return seen;
  seen.add(source);
  const item = manifest[source];
  assert.ok(item, `Manifest dependency ${source} is missing.`);
  for (const imported of item.imports ?? []) dependencyFiles(imported, seen);
  return seen;
}

function gzipGraphBytes(sources) {
  const files = new Set();
  for (const source of sources) {
    for (const dependency of dependencyFiles(source)) {
      const file = manifest[dependency]?.file;
      if (file?.endsWith(".js")) files.add(file);
    }
  }
  return [...files].reduce((total, file) => {
    const asset = assetByFile.get(file);
    assert.ok(asset, `Manifest asset ${file} is missing.`);
    return total + asset.gzipBytes;
  }, 0);
}

const [entrySource] = Object.entries(manifest).find(([, item]) => item.isEntry) ?? [];
assert.ok(entrySource, "Vite manifest has no application entry.");
const [landingSource] = moduleForSource("src/pages/LandingPage.tsx");
const publicInitialGzip = gzipGraphBytes([entrySource, landingSource]);
// The authenticated shell is the eagerly loaded router/auth/fallback graph. The workspace
// is a separately enforced lazy route chunk and does not block the shell transition screen.
const authenticatedInitialGzip = gzipGraphBytes([entrySource]);
const [chartSource] = moduleForSource("src/components/TradingChart.tsx");
const chartWorkspaceGzip = gzipGraphBytes([entrySource, chartSource]);
if (publicInitialGzip > budget.gzipBytes.publicInitial) {
  failures.push(`public initial graph: ${publicInitialGzip} > ${budget.gzipBytes.publicInitial} gzip bytes`);
}
if (authenticatedInitialGzip > budget.gzipBytes.authenticatedInitial) {
  failures.push(`authenticated initial graph: ${authenticatedInitialGzip} > ${budget.gzipBytes.authenticatedInitial} gzip bytes`);
}
if (chartWorkspaceGzip > budget.gzipBytes.chartWorkspaceGraph) {
  failures.push(`chart workspace graph: ${chartWorkspaceGzip} > ${budget.gzipBytes.chartWorkspaceGraph} gzip bytes`);
}

for (const [source, item] of Object.entries(manifest)) {
  if (item.isEntry || !item.isDynamicEntry || !item.file?.endsWith(".js")) continue;
  const asset = assetByFile.get(item.file);
  assert.ok(asset, `Dynamic asset ${item.file} is missing.`);
  if (asset.gzipBytes > budget.gzipBytes.routeChunk) {
    failures.push(`${source}: ${asset.gzipBytes} > ${budget.gzipBytes.routeChunk} gzip bytes`);
  }
}

for (const requiredLazyModule of [
  "src/pages/LandingPage.tsx",
  "src/pages/PricingPage.tsx",
  "App",
  "src/components/TradingChart.tsx",
  "src/components/IndicatorEditorPanel.tsx",
  "src/components/QuantPanel.tsx",
]) {
  const [, item] = moduleForSource(requiredLazyModule);
  if (!item.isDynamicEntry) failures.push(`${requiredLazyModule} must remain lazy-loaded`);
}

const demoMedia = assets.filter(({ name }) => /\.(png|jpe?g|webp|avif|gif|mp4|webm)$/i.test(name));
const demoMediaBytes = demoMedia.reduce((total, asset) => total + asset.bytes, 0);
if (demoMediaBytes > budget.rawBytes.productDemoMediaTotal) {
  failures.push(`product-demo media total: ${demoMediaBytes} > ${budget.rawBytes.productDemoMediaTotal} raw bytes`);
}
const fonts = assets.filter(({ name }) => /\.woff2?$/i.test(name));
const fontBytes = fonts.reduce((total, asset) => total + asset.bytes, 0);
if (fontBytes > budget.rawBytes.fontTotal) failures.push(`font total: ${fontBytes} > ${budget.rawBytes.fontTotal} raw bytes`);
if (fonts.length > budget.rawBytes.fontCount) failures.push(`font count: ${fonts.length} > ${budget.rawBytes.fontCount}`);
const stylesheetGzip = assets.filter(({ name }) => /\.css$/i.test(name)).reduce((total, asset) => total + asset.gzipBytes, 0);
if (stylesheetGzip > budget.gzipBytes.stylesheetTotal) failures.push(`stylesheet total: ${stylesheetGzip} > ${budget.gzipBytes.stylesheetTotal} gzip bytes`);

const journalTradesSource = fs.readFileSync(path.join(root, "frontend/src/components/journal/JournalTradesSurface.tsx"), "utf8");
assert.match(journalTradesSource, /const TRADE_PAGE_SIZE = 100/, "Journal long lists must use a 100-row DOM window.");
assert.match(journalTradesSource, /visible\.slice\(pageStart, pageStart \+ TRADE_PAGE_SIZE\)/, "Journal long lists must use bounded windowed rendering.");
assert.doesNotMatch(journalTradesSource, /setLimit\(\(value\) => value \+/, "Journal long lists must not grow the rendered DOM without a bound.");
assert.ok(budget.runtime.longListInitialRows <= budget.runtime.longListRows, "Long-list initial page exceeds its budget.");
for (const [label, budgetKey, baselineThresholdMs, temporaryThresholdMs] of [
  ["Frame", "runtime.sixteenPaneFrameP95Ms", 50, budget.runtime.sixteenPaneFrameP95Ms],
  ["Resize", "runtime.sixteenPaneResizeStressP95Ms", 120, budget.runtime.sixteenPaneResizeStressP95Ms],
]) {
  const exception = exceptions.exceptions.find((entry) => entry.budgetKey === budgetKey);
  assert.equal(exception?.temporaryThresholdMs, temporaryThresholdMs, `${label} exception must match the executable temporary budget.`);
  assert.ok(exception?.owner && exception?.reason && exception?.remediation, `${label} exception must name an owner, reason, and remediation.`);
  assert.equal(exception?.baselineThresholdMs, baselineThresholdMs, `${label} exception must retain the original ${baselineThresholdMs}ms baseline.`);
  assert.ok(Number.isFinite(exception?.measuredP95Ms) && exception.measuredP95Ms > exception.baselineThresholdMs && exception.measuredP95Ms <= exception.temporaryThresholdMs, `${label} exception measurement must be finite, above the baseline, and within the temporary ceiling.`);
  assert.ok(Number.isFinite(Date.parse(exception?.measuredAt ?? "")) && Date.parse(exception.measuredAt) <= Date.now(), `${label} exception must include a valid completed measurement date.`);
  assert.ok(Date.parse(exception?.expiresAt ?? "") > Date.now(), `${label} performance exception has expired.`);
  assert.ok(Date.parse(exception.expiresAt) > Date.parse(exception.measuredAt), `${label} exception expiry must follow its measurement.`);
  assert.equal(exception?.sourceTest, "e2e/chart-performance.spec.ts", `${label} exception must identify its executable source test.`);
  assert.equal(exception?.artifactName, "low-power-performance.json", `${label} exception must identify its emitted evidence artifact.`);
  assert.match(fs.readFileSync(path.join(root, exception.sourceTest), "utf8"), new RegExp(exception.artifactName.replaceAll(".", "\\.")), `${label} exception evidence artifact is not emitted by its source test.`);
}

assert.equal(failures.length, 0, `UI performance budget exceeded:\n${failures.join("\n")}`);
const heaviest = assets.sort((a, b) => b.bytes - a.bytes).slice(0, 5);
console.log(`UI performance budgets passed for ${assets.length} assets. Public initial=${publicInitialGzip} gzip bytes; authenticated initial=${authenticatedInitialGzip} gzip bytes; chart workspace=${chartWorkspaceGzip} gzip bytes; styles=${stylesheetGzip} gzip bytes; fonts=${fonts.length}/${fontBytes} raw bytes; demo media=${demoMediaBytes} raw bytes. Heaviest: ${heaviest.map((item) => `${item.name}=${item.bytes}`).join(", ")}`);
