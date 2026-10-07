import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build, buildSync } from "esbuild";

const directory = mkdtempSync(path.join(tmpdir(), "edgelab-migration-provenance-"));
const bundle = path.join(directory, "catalog.mjs");
buildSync({ bundle: true, format: "esm", platform: "node", target: "node22", outfile: bundle,
  stdin: { contents: 'export * from "./frontend/src/lib/pineCatalog.ts"; export * from "./frontend/src/lib/customIndicators.ts";', resolveDir: process.cwd(), loader: "ts" }, define: { "import.meta.env": "{}" }, logLevel: "silent" });
const lib = await import(pathToFileURL(bundle).href);
after(() => rmSync(directory, { force: true, recursive: true }));
const catalog = lib.CURATED_PINE_CATALOG;
const legacy = catalog.entries.filter((entry) => entry.pineVersion < 5);
const base = (entry) => ({ catalogId: entry.id, repository: catalog.repository, path: entry.path,
  upstreamCommit: catalog.upstreamCommit, upstreamBlobSha1: entry.upstreamBlobSha1, sourceSha256: entry.sourceSha256,
  originalPineVersion: entry.pineVersion, author: entry.author, license: entry.license, originUrl: entry.originUrl, lastFetchedAt: catalog.lastFetchedAt });
const read = (url) => readFileSync(path.resolve("frontend/public", url.slice(1)), "utf8");

test("explicit migrations verify original and derivative assets without rewriting base identity", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push(url);
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    return new Response(read(url));
  });
  assert.equal(legacy.length, 17);
  assert.equal(read("/catalog/pine/migrations/v1/LICENSE.txt"), read(`/catalog/pine/everget/${catalog.upstreamCommit}/LICENSE.txt`));
  for (const entry of legacy) {
    const migration = lib.pineCatalogMigration(catalog, entry.id);
    assert.ok(migration);
    assert.equal(migration.sourcePath, `/catalog/pine/migrations/v1/${entry.path}`);
    const imported = await lib.loadPineCatalogMigration(catalog, entry.id);
    assert.equal(imported.source, read(migration.sourcePath));
    assert.deepEqual(imported.provenance, { ...base(entry), migration: { id: migration.id, version: 5, sourceSha256: migration.sourceSha256 } });
    assert.deepEqual(lib.sanitizePineCatalogProvenance(imported.provenance), imported.provenance);
    const original = await lib.loadPineCatalogSource(catalog, entry.id);
    assert.deepEqual(original.provenance, base(entry));
    assert.equal(original.source, read(`/catalog/pine/everget/${catalog.upstreamCommit}/${entry.path}`));
    assert.equal(lib.pineCatalogCanRun(entry), false);
  }
  assert.equal(requests.length, 51);
  for (const entry of catalog.entries.filter(lib.pineCatalogCanRun)) assert.equal(lib.pineCatalogMigration(catalog, entry.id), undefined);
});

test("an upstream refetch requires a newly reviewed derivative even if original bytes stay equal", async (t) => {
  const next = structuredClone(catalog);
  next.upstreamCommit = "1".repeat(40);
  for (const entry of next.entries) entry.originUrl = `https://github.com/${next.repository}/blob/${next.upstreamCommit}/${entry.path}`;
  lib.validatePineCatalogManifest(next);
  t.mock.method(globalThis, "fetch", () => { throw new Error("An unmatched derivative must never fetch."); });
  for (const entry of legacy) {
    assert.equal(lib.pineCatalogMigration(next, entry.id), undefined);
    await assert.rejects(lib.loadPineCatalogMigration(next, entry.id), /No reviewed migration/);
  }
});

test("invalid migration metadata loses its badge while independently verified original credit survives", () => {
  const entry = legacy[0], original = base(entry), pinned = lib.pineCatalogMigration(catalog, entry.id);
  const migration = { id: pinned.id, version: 5, sourceSha256: pinned.sourceSha256 };
  for (const invalid of [null, false, "forged", {}, { ...migration, id: "forged" }, { ...migration, version: 6 }, { ...migration, sourceSha256: "0".repeat(64) }]) {
    assert.deepEqual(lib.sanitizePineCatalogProvenance({ ...original, migration: invalid }), original);
  }
  const next = { ...original, upstreamCommit: "1".repeat(40), originUrl: `https://github.com/${catalog.repository}/blob/${"1".repeat(40)}/${entry.path}` };
  assert.deepEqual(lib.sanitizePineCatalogProvenance({ ...next, migration }), next);
  assert.equal(lib.sanitizePineCatalogProvenance({ ...original, sourceSha256: "0".repeat(64), migration }), undefined);
});

test("retained compiled migration pins survive a future bundled seed revision", async () => {
  const entry = legacy[0], pin = lib.pineCatalogMigration(catalog, entry.id);
  const origin = { ...base(entry), migration: { id: pin.id, version: 5, sourceSha256: pin.sourceSha256 } };
  const next = structuredClone(catalog); next.upstreamCommit = "1".repeat(40);
  for (const item of next.entries) item.originUrl = `https://github.com/${next.repository}/blob/${next.upstreamCommit}/${item.path}`;
  const output = (await build({ bundle: true, format: "esm", platform: "node", target: "node22", write: false,
    stdin: { contents: 'export * from "./frontend/src/lib/pineCatalog.ts";', resolveDir: process.cwd(), loader: "ts" },
    plugins: [{ name: "future-bundled-seed", setup(build) {
      build.onLoad({ filter: /pineCatalogManifest\.json$/ }, () => ({ contents: JSON.stringify(next), loader: "json" }));
    } }], logLevel: "silent" })).outputFiles[0].text;
  const future = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  assert.equal(future.CURATED_PINE_CATALOG.upstreamCommit, next.upstreamCommit);
  assert.deepEqual(future.sanitizePineCatalogProvenance(origin), origin);
  assert.equal(future.pineCatalogMigration(future.CURATED_PINE_CATALOG, entry.id), undefined);
});

test("migration source tampering and invalid base bytes fail before an import can open", async (t) => {
  const entry = legacy[0], migration = lib.pineCatalogMigration(catalog, entry.id);
  for (const corruptOriginal of [true, false]) {
    const requests = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      requests.push(url);
      return new Response(read(url) + ((url === migration.sourcePath) !== corruptOriginal ? "\n// forged" : ""));
    });
    await assert.rejects(lib.loadPineCatalogMigration(catalog, entry.id), /does not match/);
    assert.equal(requests.length, corruptOriginal ? 1 : 2);
  }
});

test("migration fetch bounds streamed bytes and propagates cancellation", async (t) => {
  const entry = legacy[0], migration = lib.pineCatalogMigration(catalog, entry.id);
  let reads = 0, cancelled = false;
  t.mock.method(globalThis, "fetch", async (url) => url !== migration.sourcePath ? new Response(read(url)) : new Response(new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(12_000)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 })));
  await assert.rejects(lib.loadPineCatalogMigration(catalog, entry.id), /oversized/);
  assert.equal(reads, 2); assert.equal(cancelled, true);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    options.signal.throwIfAborted(); return new Response(read(url));
  });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(lib.loadPineCatalogMigration(catalog, entry.id, controller.signal), { name: "AbortError" });
});

test("saved edited migrations, revisions, copies and chart instances retain both immutable bases", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => new Response(read(url)));
  const entry = legacy[0], imported = await lib.loadPineCatalogMigration(catalog, entry.id);
  const prepared = (source) => ({ kind: "prepare", source, language: "pine", pineVersion: 5, declaration: "indicator", name: entry.name, overlay: true, inputDefinitions: [], diagnostics: [] });
  const first = lib.saveCustomIndicator([], { category: "custom", color: "#32d3ee", description: "Imported migration", id: "", inputs: {}, name: entry.name, preview: "trend", source: imported.source, synonyms: [], catalogOrigin: imported.provenance }, { pinePrepared: prepared(imported.source) });
  const instance = lib.createCustomIndicatorInstance(first.script);
  const edited = imported.source + "\n// user edit";
  const second = lib.saveCustomIndicator(first.scripts, { ...first.script, source: edited }, { pinePrepared: prepared(edited) });
  assert.deepEqual(second.script.catalogOrigin, imported.provenance);
  assert.deepEqual(second.script.versions[0].catalogOrigin, imported.provenance);
  assert.deepEqual(lib.sanitizeCustomIndicators(second.scripts)[0].catalogOrigin, imported.provenance);
  assert.deepEqual(lib.duplicateCustomIndicator(second.script).catalogOrigin, imported.provenance);
  assert.equal(instance.customScriptSource, imported.source);
  assert.deepEqual(instance.customCatalogOrigin, imported.provenance);
});
