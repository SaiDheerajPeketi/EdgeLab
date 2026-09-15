import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const assetRoot = path.join(root, "frontend/dist/assets");
const manifestPath = path.join(root, "frontend/dist/.vite/manifest.json");
const budget = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-performance-budgets.json"), "utf8"));
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
  const matches = Object.entries(manifest).filter(([source, item]) =>
    source.endsWith(fragment) || item.src?.endsWith(fragment) || item.name === fragment,
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
if (publicInitialGzip > budget.gzipBytes.publicInitial) {
  failures.push(`public initial graph: ${publicInitialGzip} > ${budget.gzipBytes.publicInitial} gzip bytes`);
}
if (authenticatedInitialGzip > budget.gzipBytes.authenticatedInitial) {
  failures.push(`authenticated initial graph: ${authenticatedInitialGzip} > ${budget.gzipBytes.authenticatedInitial} gzip bytes`);
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

const journalTradesSource = fs.readFileSync(path.join(root, "frontend/src/components/journal/JournalTradesSurface.tsx"), "utf8");
assert.match(journalTradesSource, /useState\(100\)/, "Journal long lists must start below the 200-row render budget.");
assert.match(journalTradesSource, /visible\.slice\(0, limit\)/, "Journal long lists must use bounded rendering.");
assert.ok(budget.runtime.longListInitialRows <= budget.runtime.longListRows, "Long-list initial page exceeds its budget.");

assert.equal(failures.length, 0, `UI performance budget exceeded:\n${failures.join("\n")}`);
const heaviest = assets.sort((a, b) => b.bytes - a.bytes).slice(0, 5);
console.log(`UI performance budgets passed for ${assets.length} assets. Public initial=${publicInitialGzip} gzip bytes; authenticated initial=${authenticatedInitialGzip} gzip bytes; demo media=${demoMediaBytes} raw bytes. Heaviest: ${heaviest.map((item) => `${item.name}=${item.bytes}`).join(", ")}`);
