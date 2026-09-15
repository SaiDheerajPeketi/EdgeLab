import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const assetRoot = path.join(root, "frontend/dist/assets");
const budget = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-performance-budgets.json"), "utf8"));
assert.ok(fs.existsSync(assetRoot), "Build frontend before checking UI performance budgets.");

const assets = fs.readdirSync(assetRoot).map((name) => ({
  name,
  bytes: fs.statSync(path.join(assetRoot, name)).size,
}));
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

assert.equal(failures.length, 0, `UI performance budget exceeded:\n${failures.join("\n")}`);
const heaviest = assets.sort((a, b) => b.bytes - a.bytes).slice(0, 5);
console.log(`UI asset budgets passed for ${assets.length} files. Heaviest: ${heaviest.map((item) => `${item.name}=${item.bytes}`).join(", ")}`);
