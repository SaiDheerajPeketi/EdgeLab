import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../..", import.meta.url));
const output = await build({
  bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020",
  write: false, logLevel: "silent", define: { "import.meta.env": "{}" },
  stdin: { contents: 'export * from "./frontend/src/lib/pineCatalog.ts"; export * from "./frontend/src/lib/customIndicators.ts";',
    resolveDir: root, loader: "ts" },
});
const lib = await import("data:text/javascript;base64," + Buffer.from(output.outputFiles[0].text).toString("base64"));
const seed = JSON.parse(readFileSync(path.join(root, "frontend/src/lib/pineCatalogManifestV2.json"), "utf8"));
const A = "a".repeat(40), B = "b".repeat(40), base = "/catalog/pine/everget-v2";
const revision = (commit) => ({
  ...structuredClone(seed), upstreamCommit: commit,
  entries: seed.entries.map(entry => ({ ...entry,
    originUrl: "https://github.com/" + seed.repository + "/blob/" + commit + "/" + entry.path })),
});
const catalogA = revision(A), catalogB = revision(B);
const index = (extra = {}) => ({ schemaVersion: 1, repository: seed.repository, revisions: [A, B], ...extra });
function boundary(t, initial, manifests = { [A]: catalogA, [B]: catalogB }, sources = {}) {
  const requests = [];
  let current = initial;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push(url);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-cache");
    if (url === base + "/index.json") return new Response(JSON.stringify(current));
    const commit = url.slice(base.length + 1).split("/")[0];
    if (url === base + "/" + commit + "/manifest.json" && manifests[commit])
      return new Response(JSON.stringify(manifests[commit]));
    if (Object.hasOwn(sources, url)) return new Response(sources[url]);
    return new Response("missing", { status: 404 });
  });
  return { requests, setIndex(value) { current = value; } };
}

test("explicit current revision can select an older archive without changing archive order", async t => {
  const fetch = boundary(t, index({ currentRevision: A }));
  const loaded = await lib.loadPineCatalog();
  assert.equal(loaded.upstreamCommit, A);
  assert.deepEqual(fetch.requests, [base + "/index.json", base + "/" + A + "/manifest.json"]);
  assert.deepEqual(loaded.entries, catalogA.entries);
});

test("legacy indexes without a selection pointer still select the last archived revision", async t => {
  const fetch = boundary(t, index());
  assert.equal((await lib.loadPineCatalog()).upstreamCommit, B);
  assert.equal(fetch.requests.at(-1), base + "/" + B + "/manifest.json");
});

test("present invalid or absent-from-archive pointers fail before any manifest fetch", async t => {
  const fetch = boundary(t, null);
  for (const pointer of [null, false, 0, "", {}, [], "../../private", "A".repeat(40), "c".repeat(40)]) {
    fetch.setIndex(index({ currentRevision: pointer }));
    const before = fetch.requests.length;
    await assert.rejects(lib.loadPineCatalog(), /Invalid Pine catalog/i);
    assert.deepEqual(fetch.requests.slice(before), [base + "/index.json"]);
  }
});

test("index shape, duplicate archives, repository and revision URL attacks fail closed", async t => {
  const fetch = boundary(t, null);
  const invalid = [null, false, [], "text", 1, {}, index({ schemaVersion: 2 }),
    index({ repository: "other/repository" }), index({ revisions: [] }),
    index({ revisions: [A, A] }), index({ revisions: [A, 1] }),
    index({ revisions: ["https://evil.test/source"] }),
    index({ revisions: ["../" + A] }),
    index({ revisions: Array.from({ length: 257 }, (_, n) => n.toString(16).padStart(40, "0")) })];
  for (const value of invalid) {
    fetch.setIndex(value);
    const before = fetch.requests.length;
    await assert.rejects(lib.loadPineCatalog());
    assert.deepEqual(fetch.requests.slice(before), [base + "/index.json"]);
  }
});

test("prototype-looking JSON keys and inherited pointers cannot redirect a legacy index", async t => {
  const fetch = boundary(t, JSON.parse(JSON.stringify(index()).slice(0, -1) +
    ',"__proto__":{"currentRevision":"' + A + '"},"constructor":{"prototype":{"currentRevision":"' + A + '"}}}'));
  assert.equal((await lib.loadPineCatalog()).upstreamCommit, B);
  Object.defineProperty(Object.prototype, "currentRevision", { value: "../../private", configurable: true });
  try {
    fetch.setIndex(index());
    assert.equal((await lib.loadPineCatalog()).upstreamCommit, B);
  } finally { delete Object.prototype.currentRevision; }
});

test("selected manifest must agree with its archive identity and preserve exact trusted paths and origins", async t => {
  const manifests = { [A]: catalogB };
  const fetch = boundary(t, index({ currentRevision: A }), manifests);
  await assert.rejects(lib.loadPineCatalog(), /revision does not match/i);
  const mutations = [
    value => { value.entries[0].originUrl = "https://evil.test/source"; },
    value => { value.entries[0].path = "../private.pine"; },
    value => { value.entries[0].sourceSha256 = "not-a-digest"; },
    value => { value.entries[0].sourceBytes = "100"; },
    value => { value.licenseSha256 = "0"; },
  ];
  for (const mutate of mutations) {
    manifests[A] = structuredClone(catalogA); mutate(manifests[A]);
    await assert.rejects(lib.loadPineCatalog(), /Invalid Pine catalog/i);
  }
  assert.ok(fetch.requests.every(url => url === base + "/index.json" || url === base + "/" + A + "/manifest.json"));
});

test("source corruption is rejected even after the selected catalog validates", async t => {
  const entry = catalogA.entries.find(lib.pineCatalogCanRun);
  const source = readFileSync(path.join(root, "frontend/public", base, seed.upstreamCommit, entry.path), "utf8");
  const url = base + "/" + A + "/" + entry.path, sources = { [url]: source + "\n// corrupt" };
  boundary(t, index({ currentRevision: A }), undefined, sources);
  const loaded = await lib.loadPineCatalog();
  await assert.rejects(lib.loadPineCatalogSource(loaded, entry.id), /does not match its pinned revision/i);
  sources[url] = source;
  assert.equal((await lib.loadPineCatalogSource(loaded, entry.id)).source, source);
});

test("switching current catalog does not rewrite imported, edited, duplicated or chart-snapshot source pins", async t => {
  const entry = catalogA.entries.find(lib.pineCatalogCanRun);
  const source = readFileSync(path.join(root, "frontend/public", base, seed.upstreamCommit, entry.path), "utf8");
  const fetch = boundary(t, index({ currentRevision: A }), undefined, { [base + "/" + A + "/" + entry.path]: source });
  const loadedA = await lib.loadPineCatalog(), imported = await lib.loadPineCatalogSource(loadedA, entry.id);
  const prepared = text => ({ kind: "prepare", source: text, language: "pine", pineVersion: 6,
    declaration: "indicator", name: entry.name, overlay: true, inputDefinitions: [], diagnostics: [] });
  const saved = lib.saveCustomIndicator([], { category: "custom", color: "#32d3ee", description: "Imported",
    id: "", inputs: {}, name: entry.name, preview: "trend", source, synonyms: [], catalogOrigin: imported.provenance },
    { pinePrepared: prepared(source) });
  const snapshot = lib.createCustomIndicatorInstance(saved.script);
  const editedSource = source + "\n// saved personal edit";
  const edited = lib.saveCustomIndicator(saved.scripts, { ...saved.script, source: editedSource },
    { pinePrepared: prepared(editedSource) }).script;
  const duplicate = lib.duplicateCustomIndicator(edited);
  fetch.setIndex(index({ currentRevision: B }));
  assert.equal((await lib.loadPineCatalog()).upstreamCommit, B);
  for (const copy of [edited, duplicate, lib.sanitizeCustomIndicators([edited])[0]]) {
    assert.equal(copy.source, editedSource);
    assert.deepEqual(copy.catalogOrigin, imported.provenance);
    assert.equal(copy.catalogOrigin.upstreamCommit, A);
  }
  assert.equal(snapshot.customScriptSource, source);
  assert.deepEqual(snapshot.customCatalogOrigin, imported.provenance);
  assert.equal(loadedA.upstreamCommit, A);
  assert.equal((await lib.loadPineCatalogSource(loadedA, entry.id)).source, source);
});
