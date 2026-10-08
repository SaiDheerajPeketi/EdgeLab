import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { readPineEngineSources } from "../../scripts/pine-engine.mjs";

const require = createRequire(import.meta.url);
const installedRoot = path.dirname(path.dirname(require.resolve("pinets")));
const reviewedRoot = new URL("../../frontend/vendor/pinets/", import.meta.url);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-pine-integrity-"));
after(() => fs.rmSync(temporary, { recursive: true, force: true }));
const hash = value => createHash("sha256").update(value).digest("hex");

function fixture() {
  const root = fs.mkdtempSync(path.join(temporary, "case-"));
  const packageRoot = path.join(root, "package");
  const vendorRoot = path.join(root, "reviewed");
  fs.mkdirSync(path.join(packageRoot, "dist/types"), { recursive: true });
  fs.mkdirSync(vendorRoot);
  fs.copyFileSync(path.join(installedRoot, "package.json"), path.join(packageRoot, "package.json"));
  const map = fs.readFileSync(path.join(installedRoot, "dist/pinets.min.browser.es.js.map"));
  fs.writeFileSync(path.join(packageRoot, "dist/pinets.min.browser.es.js.map"), map);
  const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", reviewedRoot)));
  for (const barrel of manifest.barrels) fs.copyFileSync(path.join(installedRoot, "dist/types", barrel.declaration), path.join(packageRoot, "dist/types", barrel.declaration));
  for (const override of manifest.overrides) {
    const destination = path.join(vendorRoot, override.file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(new URL(override.file, reviewedRoot), destination);
  }
  fs.copyFileSync(new URL(manifest.namespaceMembers.file, reviewedRoot), path.join(vendorRoot, manifest.namespaceMembers.file));
  const save = () => fs.writeFileSync(path.join(vendorRoot, "manifest.json"), JSON.stringify(manifest));
  save();
  return { root, packageRoot, vendorRoot, manifest, save, map };
}

test("reviewed sources and pristine reference resolve independently without package mutation", () => {
  const f = fixture();
  const patched = readPineEngineSources(f);
  const original = readPineEngineSources({ ...f, patched: false });
  assert.equal(f.manifest.overrides.length, 30);
  for (const source of ["src/namespaces/label/LabelHelper.ts", "src/namespaces/box/BoxHelper.ts", "src/namespaces/line/LineHelper.ts", "src/namespaces/linefill/LinefillHelper.ts", "src/namespaces/linefill/LinefillObject.ts", "src/namespaces/Core.ts", "src/transpiler/slicing/buildLtfSlices.ts", "src/namespaces/Ticker.ts", "src/namespaces/request/methods/security.ts", "src/namespaces/request/methods/security_lower_tf.ts", "src/namespaces/request/methods/param.ts", "src/transpiler/pineToJS/inputs/constEval.ts", "src/namespaces/Str.ts", "src/namespaces/input/methods/enum.ts", "src/transpiler/pineToJS/inputs/analyzeInputs.ts", "src/Indicator/scanInputs.ts", "src/namespaces/strategy/utils.ts", "src/namespaces/strategy/methods/entry.ts", "src/namespaces/strategy/methods/exit.ts", "src/namespaces/strategy/methods/cancel_all.ts"]) {
    assert.ok(f.manifest.overrides.some((override) => override.source === source));
    assert.notEqual(patched.get(source), original.get(source));
  }
  assert.notEqual(patched.get("src/PineTS.class.ts"), original.get("src/PineTS.class.ts"));
  assert.notEqual(patched.get("src/transpiler/transformers/ExpressionTransformer.ts"), original.get("src/transpiler/transformers/ExpressionTransformer.ts"));
  assert.equal(patched.get("src/Series.ts"), original.get("src/Series.ts"));
  assert.ok(patched.has("node_modules/acorn/dist/acorn.mjs"));
  assert.deepEqual(fs.readFileSync(path.join(f.packageRoot, "dist/pinets.min.browser.es.js.map")), f.map);
});

test("wrong installed version or source-map bytes fail closed", () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.packageRoot, "package.json"), JSON.stringify({ version: "0.11.1" }));
  assert.throws(() => readPineEngineSources(f), /version/);
  fs.copyFileSync(path.join(installedRoot, "package.json"), path.join(f.packageRoot, "package.json"));
  fs.appendFileSync(path.join(f.packageRoot, "dist/pinets.min.browser.es.js.map"), " ");
  assert.throws(() => readPineEngineSources(f), /integrity/);
});

test("altered override and altered original source hashes fail closed", () => {
  const f = fixture(), override = f.manifest.overrides[0];
  fs.appendFileSync(path.join(f.vendorRoot, override.file), "\n// unexpected change\n");
  assert.throws(() => readPineEngineSources(f), /integrity/);
  override.upstreamSha256 = "0".repeat(64); f.save();
  assert.throws(() => readPineEngineSources(f), /outdated/);
});

test("override traversal, duplicate targets and escaping symlinks are rejected", () => {
  const f = fixture(), override = f.manifest.overrides[0], originalFile = override.file;
  override.file = "../outside.ts"; f.save();
  assert.throws(() => readPineEngineSources(f), /reviewed directory/);
  override.file = originalFile;
  f.manifest.overrides.push({ ...override }); f.save();
  assert.throws(() => readPineEngineSources(f), /outdated/);
  f.manifest.overrides.pop(); f.save();
  const outside = path.join(f.root, "outside.ts"), filename = path.join(f.vendorRoot, originalFile);
  fs.copyFileSync(filename, outside); fs.unlinkSync(filename); fs.symlinkSync(outside, filename);
  assert.throws(() => readPineEngineSources(f), /escaped/);
});

test("sealed source maps still reject unknown, traversal and duplicate entries", () => {
  for (const name of ["../src/../outside.ts", "../node_modules/unknown/index.js", "../src/PineTS.class.ts"]) {
    const f = fixture(), map = JSON.parse(f.map);
    map.sources.push(name); map.sourcesContent.push("export const unexpected = true;");
    const bytes = JSON.stringify(map);
    fs.writeFileSync(path.join(f.packageRoot, "dist/pinets.min.browser.es.js.map"), bytes);
    f.manifest.sourceMapSha256 = hash(bytes); f.save();
    assert.throws(() => readPineEngineSources(f), /source path/);
  }
});

test("missing overrides and modified declaration barrels fail closed", () => {
  const f = fixture();
  fs.unlinkSync(path.join(f.vendorRoot, f.manifest.overrides[0].file));
  assert.throws(() => readPineEngineSources(f), /ENOENT/);
  fs.appendFileSync(path.join(f.packageRoot, "dist/types", f.manifest.barrels[0].declaration), "\nexport const injected = 1;");
  assert.throws(() => readPineEngineSources(f), /barrel.*integrity/);
});


test("namespace inventory bytes, path and provenance fail closed", () => {
  const f = fixture(), file = path.join(f.vendorRoot, f.manifest.namespaceMembers.file);
  const original = fs.readFileSync(file);
  fs.appendFileSync(file, " ");
  assert.throws(() => readPineEngineSources(f), /inventory.*integrity/);
  fs.writeFileSync(file, original);
  f.manifest.namespaceMembers.file = "../outside.json"; f.save();
  assert.throws(() => readPineEngineSources(f), /Invalid.*inventory/);
  f.manifest.namespaceMembers.file = "namespace-members.json";
  const inventory = JSON.parse(original);
  inventory.namespaceSourcesSha256 = "0".repeat(64);
  const modified = JSON.stringify(inventory);
  fs.writeFileSync(file, modified);
  f.manifest.namespaceMembers.sha256 = hash(modified); f.save();
  assert.throws(() => readPineEngineSources(f), /provenance/);
  fs.writeFileSync(file, original);
  f.manifest.namespaceMembers.sha256 = hash(original); f.save();
  const outside = path.join(f.root, "outside.json");
  fs.writeFileSync(outside, original); fs.unlinkSync(file); fs.symlinkSync(outside, file);
  assert.throws(() => readPineEngineSources(f), /inventory escaped/);
});


test("resealed namespace inventories still reject invalid member lists and digests", () => {
  for (const change of [
    inventory => { inventory.membersSha256 = "0".repeat(64); },
    inventory => { inventory.namespaces.math.push("abs"); },
    inventory => { inventory.namespaces.math.push("_private"); },
  ]) {
    const f = fixture(), file = path.join(f.vendorRoot, f.manifest.namespaceMembers.file);
    const inventory = JSON.parse(fs.readFileSync(file)); change(inventory);
    const bytes = JSON.stringify(inventory); fs.writeFileSync(file, bytes);
    f.manifest.namespaceMembers.sha256 = hash(bytes); f.save();
    assert.throws(() => readPineEngineSources(f), /member.*(list|digest)/);
  }
});
