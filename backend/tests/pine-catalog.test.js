import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile, cp, mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { buildSync } from "esbuild";
import { refreshPineCatalog } from "../../scripts/refresh-pine-catalog.mjs";

const directory = mkdtempSync(path.join(tmpdir(), "edgelab-pine-catalog-"));
const bundle = path.join(directory, "catalog.mjs");
buildSync({ bundle: true, format: "esm", platform: "node", target: "node22", outfile: bundle,
  stdin: { contents: 'export * from "./frontend/src/lib/pineCatalog.ts"; export * from "./frontend/src/lib/sourceSha256.ts"; export * from "./frontend/src/lib/customIndicators.ts";', resolveDir: process.cwd(), loader: "ts" }, define: { "import.meta.env": "{}" }, logLevel: "silent" });
const lib = await import(pathToFileURL(bundle).href);
after(() => rmSync(directory, { force: true, recursive: true }));
const catalog = lib.CURATED_PINE_CATALOG;
const sourceRoot = path.resolve("frontend/public/catalog/pine/everget", catalog.upstreamCommit);
const source = (entry) => readFileSync(path.join(sourceRoot, entry.path), "utf8");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const origin = (entry) => ({ catalogId: entry.id, repository: catalog.repository, path: entry.path,
  upstreamCommit: catalog.upstreamCommit, upstreamBlobSha1: entry.upstreamBlobSha1, sourceSha256: entry.sourceSha256,
  originalPineVersion: entry.pineVersion, author: entry.author, license: entry.license, originUrl: entry.originUrl, lastFetchedAt: catalog.lastFetchedAt });

test("all 21 originals match pinned SHA-256, Git blob, version, attribution and licence", () => {
  assert.equal(catalog.entries.length, 21);
  assert.equal(catalog.entries.filter(lib.pineCatalogCanRun).length, 4);
  for (const entry of catalog.entries) {
    const raw = readFileSync(path.join(sourceRoot, entry.path));
    assert.equal(hash(raw), entry.sourceSha256);
    assert.equal(createHash("sha1").update(`blob ${raw.length}\0`).update(raw).digest("hex"), entry.upstreamBlobSha1);
    assert.equal(lib.sourceSha256(source(entry)), hash(raw));
    lib.validatePineCatalogSource(source(entry), entry);
    assert.throws(() => lib.validatePineCatalogSource(source(entry) + "\n// modified", entry));
  }
  assert.equal(hash(readFileSync(path.join(sourceRoot, "LICENSE.txt"))), catalog.licenseSha256);
  for (const value of ["", "abc", "é😀", "x".repeat(64), "a".repeat(10000)]) assert.equal(lib.sourceSha256(value), hash(value));
});

test("catalog rejects arbitrary origins, paths, mismatched pins and forged seed provenance", () => {
  for (const change of [{ repository: "other/repo" }, { upstreamCommit: "../../escape" }, { entries: [{ ...catalog.entries[0], path: "../private.pine" }, ...catalog.entries.slice(1)] }, { entries: [{ ...catalog.entries[0], originUrl: "https://evil.test/file" }, ...catalog.entries.slice(1)] }]) assert.throws(() => lib.validatePineCatalogManifest({ ...catalog, ...change }));
  assert.equal(lib.sanitizePineCatalogProvenance({ ...origin(catalog.entries[0]), sourceSha256: "0".repeat(64) }), undefined);
});

test("refresh appends source/version provenance and leaves old revision bytes unchanged", async () => {
  const output = path.join(directory, "refresh");
  await cp(path.dirname(sourceRoot), output, { recursive: true });
  const nextCommit = "1".repeat(40), requests = [];
  const upgraded = catalog.entries.find((entry) => entry.name === "Exponential Moving Average");
  const fetchImpl = async (url, options) => {
    requests.push(url); assert.equal(options.redirect, "error");
    const prefix = `https://raw.githubusercontent.com/${catalog.repository}/${nextCommit}/`;
    assert.ok(url.startsWith(prefix));
    const relative = url.slice(prefix.length);
    let raw = readFileSync(path.join(sourceRoot, relative === "LICENSE" ? "LICENSE.txt" : relative));
    if (relative === upgraded.path) raw = Buffer.from(raw.toString().replace("//@version=3", "//@version=6"));
    return new Response(raw, { status: 200 });
  };
  const next = await refreshPineCatalog({ commit: nextCommit, outputDir: output, fetchImpl });
  assert.equal(next.upstreamCommit, nextCommit);
  assert.equal(next.entries.find((entry) => entry.id === upgraded.id).pineVersion, 6);
  assert.notEqual(next.entries.find((entry) => entry.id === upgraded.id).sourceSha256, upgraded.sourceSha256);
  assert.equal(hash(await readFile(path.join(output, catalog.upstreamCommit, upgraded.path))), upgraded.sourceSha256);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "index.json"), "utf8")).revisions, [catalog.upstreamCommit, nextCommit]);
  const firstManifest = await readFile(path.join(output, nextCommit, "manifest.json"), "utf8");
  await refreshPineCatalog({ commit: nextCommit, outputDir: output, fetchImpl: () => { throw new Error("Existing revision must not fetch or overwrite."); } });
  assert.equal(await readFile(path.join(output, nextCommit, "manifest.json"), "utf8"), firstManifest);
  assert.equal(requests.length, 22);
  await assert.rejects(refreshPineCatalog({ commit: "https://evil.test", outputDir: output, fetchImpl }), /full lowercase/);
});

test("edited and duplicated user copies plus chart snapshots retain pinned upstream provenance", () => {
  const entry = catalog.entries.find(lib.pineCatalogCanRun), original = source(entry), provenance = origin(entry);
  const prepared = (text) => ({ kind: "prepare", source: text, language: "pine", pineVersion: 6, declaration: "indicator", name: entry.name, overlay: true, inputDefinitions: [], diagnostics: [] });
  const draft = { category: "custom", color: "#32d3ee", description: "Imported", id: "", inputs: {}, name: entry.name, preview: "trend", source: original, synonyms: [], catalogOrigin: provenance };
  const first = lib.saveCustomIndicator([], draft, { pinePrepared: prepared(original) });
  const chart = lib.createCustomIndicatorInstance(first.script);
  const edited = original + "\n// user edit";
  const second = lib.saveCustomIndicator(first.scripts, { ...first.script, source: edited }, { pinePrepared: prepared(edited) });
  assert.deepEqual(second.script.catalogOrigin, provenance);
  assert.deepEqual(second.script.versions[0].catalogOrigin, provenance);
  assert.deepEqual(lib.sanitizeCustomIndicators(second.scripts)[0].catalogOrigin, provenance);
  assert.equal(chart.customScriptSource, original);
  assert.deepEqual(chart.customCatalogOrigin, provenance);
  assert.deepEqual(lib.duplicateCustomIndicator(second.script).catalogOrigin, provenance);
});


const localFetch = async (url) => {
  const relative = url.split("/").slice(6).join("/");
  return new Response(readFileSync(path.join(sourceRoot, relative === "LICENSE" ? "LICENSE.txt" : relative)));
};
const copiedOutput = async (name) => {
  const output = path.join(directory, name);
  await cp(path.dirname(sourceRoot), output, { recursive: true });
  return output;
};

test("chunked oversize fetch stops reading, cancels the stream and releases the refresh lock", async () => {
  const output = await copiedOutput("oversized");
  const commit = "2".repeat(40);
  let reads = 0, cancelled = false;
  const fetchImpl = async (url) => {
    if (!url.endsWith(catalog.entries[0].path)) return localFetch(url);
    const response = new Response(new ReadableStream({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(12_000)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }));
    response.arrayBuffer = () => { throw new Error("An unbounded arrayBuffer read must never occur."); };
    return response;
  };
  await assert.rejects(refreshPineCatalog({ commit, outputDir: output, fetchImpl }), /oversized/);
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
  assert.equal((await readdir(output)).some((name) => name.startsWith(".refresh") || name.startsWith(".pending")), false);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "index.json"), "utf8")).revisions, [catalog.upstreamCommit]);
  // A rejected queue entry cannot block the next refresh.
  await refreshPineCatalog({ commit, outputDir: output, fetchImpl: localFetch });
});

test("refresh rejects truncated UTF-8 before publishing a revision", async () => {
  const output = await copiedOutput("invalid-utf8");
  const commit = "3".repeat(40);
  await assert.rejects(refreshPineCatalog({ commit, outputDir: output, fetchImpl: async (url) => {
    if (!url.endsWith(catalog.entries[0].path)) return localFetch(url);
    return new Response(Buffer.concat([readFileSync(path.join(sourceRoot, catalog.entries[0].path)), Buffer.from([0xe2, 0x82])]));
  } }), /valid UTF-8/);
  assert.equal((await readdir(output)).includes(commit), false);
  assert.equal((await readdir(output)).includes(".refresh.lock"), false);
});

test("existing immutable revisions verify complete source and licence metadata without fetching", async () => {
  const output = await copiedOutput("immutable-metadata");
  const manifestPath = path.join(output, catalog.upstreamCommit, "manifest.json");
  const original = JSON.parse(await readFile(manifestPath, "utf8"));
  const noFetch = () => { throw new Error("Immutable validation must not fetch."); };
  const cases = [
    (value) => { value.schemaVersion = 2; },
    (value) => { value.repository = "other/repo"; },
    (value) => { value.upstreamCommit = "1".repeat(40); },
    (value) => { value.licenseSha256 = "0".repeat(64); },
    (value) => { value.lastFetchedAt = "invalid"; },
    ...[{ id: "forged" }, { path: "../outside.pine" }, { name: "forged" }, { author: "forged" }, { license: "MPL-2.0" },
      { copyright: "// forged" }, { licenseNotice: "// GPL-3.0 forged" }, { pineVersion: 5 }, { sourceBytes: 1 },
      { sourceSha256: "0".repeat(64) }, { upstreamBlobSha1: "0".repeat(40) }, { originUrl: "https://evil.test/source" }]
      .map((change) => (value) => { Object.assign(value.entries[0], change); }),
    (value) => { value.entries[1] = value.entries[0]; },
  ];
  for (const mutate of cases) {
    const changed = structuredClone(original); mutate(changed);
    await writeFile(manifestPath, JSON.stringify(changed));
    await assert.rejects(refreshPineCatalog({ commit: catalog.upstreamCommit, outputDir: output, fetchImpl: noFetch }), /immutable/);
  }
  await writeFile(manifestPath, JSON.stringify(original));
  const licencePath = path.join(output, catalog.upstreamCommit, "LICENSE.txt");
  const invalidLicence = Buffer.from("GPL-3.0 replacement without verified full licence headers");
  await writeFile(licencePath, invalidLicence);
  const changed = { ...original, licenseSha256: hash(invalidLicence) };
  await writeFile(manifestPath, JSON.stringify(changed));
  await assert.rejects(refreshPineCatalog({ commit: catalog.upstreamCommit, outputDir: output, fetchImpl: noFetch }), /licence changed/);
});

test("a full 256-revision index permits existing validation and rejects only new appends", async () => {
  const output = await copiedOutput("capacity");
  const revisions = [catalog.upstreamCommit, ...Array.from({ length: 255 }, (_, index) => index.toString(16).padStart(40, "0"))];
  const indexPath = path.join(output, "index.json");
  const index = { schemaVersion: 1, repository: catalog.repository, revisions };
  await writeFile(indexPath, JSON.stringify(index));
  const fetchImpl = () => { throw new Error("Capacity validation must not fetch."); };
  const existing = await refreshPineCatalog({ commit: catalog.upstreamCommit, outputDir: output, fetchImpl });
  assert.equal(existing.upstreamCommit, catalog.upstreamCommit);
  await assert.rejects(refreshPineCatalog({ commit: "4".repeat(40), outputDir: output, fetchImpl }), /capacity is full/);
  assert.deepEqual(JSON.parse(await readFile(indexPath, "utf8")), index);
});

test("concurrent refreshes serialize append operations and retain both revisions", async () => {
  const output = await copiedOutput("concurrent");
  const commits = ["5".repeat(40), "6".repeat(40)];
  let activeCommit = null;
  const fetchImpl = async (url) => {
    const commit = url.split("/")[5];
    activeCommit ??= commit;
    assert.equal(commit, activeCommit, "A second revision must wait for the first append.");
    const result = await localFetch(url);
    if (url.endsWith("/LICENSE")) activeCommit = null;
    return result;
  };
  const results = await Promise.all(commits.map((commit) => refreshPineCatalog({ commit, outputDir: output, fetchImpl })));
  assert.deepEqual(results.map((result) => result.upstreamCommit), commits);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "index.json"), "utf8")).revisions, [catalog.upstreamCommit, ...commits]);
  for (const commit of commits) assert.equal(JSON.parse(await readFile(path.join(output, commit, "manifest.json"), "utf8")).upstreamCommit, commit);
  assert.equal((await readdir(output)).includes(".refresh.lock"), false);
});

test("a foreign filesystem lock reports busy and is never removed", async () => {
  const output = path.join(directory, "foreign-lock");
  await mkdir(output);
  const lock = path.join(output, ".refresh.lock");
  await writeFile(lock, "other-process-owner");
  await assert.rejects(refreshPineCatalog({ commit: "7".repeat(40), outputDir: output, fetchImpl: localFetch }), /busy in another process/);
  assert.equal(await readFile(lock, "utf8"), "other-process-owner");
  await unlink(lock);
  // Even replacing our own lock while we run does not authorize deleting the replacement.
  let replaced = false;
  await refreshPineCatalog({ commit: "7".repeat(40), outputDir: output, fetchImpl: async (url) => {
    if (!replaced) { replaced = true; await writeFile(lock, "replacement-owner"); }
    return localFetch(url);
  } });
  assert.equal(await readFile(lock, "utf8"), "replacement-owner");
});


test("explicit provenance clearing differs from omitted metadata and preserves historical/chart origins", () => {
  const entry = catalog.entries.find(lib.pineCatalogCanRun), original = source(entry), provenance = origin(entry);
  const prepared = (text) => ({ kind: "prepare", source: text, language: "pine", pineVersion: 6, declaration: "indicator", name: entry.name, overlay: true, inputDefinitions: [], diagnostics: [] });
  const draft = { category: "custom", color: "#32d3ee", description: "Imported", id: "", inputs: {}, name: entry.name, preview: "trend", source: original, synonyms: [], catalogOrigin: provenance };
  const first = lib.saveCustomIndicator([], draft, { pinePrepared: prepared(original) });
  const snapshot = lib.createCustomIndicatorInstance(first.script);
  const { catalogOrigin: omitted, ...legacyCaller } = first.script;
  const retained = lib.saveCustomIndicator(first.scripts, legacyCaller, { pinePrepared: prepared(original) });
  assert.deepEqual(retained.script.catalogOrigin, provenance);
  const cleared = lib.saveCustomIndicator(retained.scripts, { ...retained.script, catalogOrigin: undefined }, { pinePrepared: prepared(original) });
  assert.equal(cleared.script.catalogOrigin, undefined);
  assert.deepEqual(cleared.script.versions.map((version) => version.catalogOrigin), [provenance, provenance]);
  assert.deepEqual(snapshot.customCatalogOrigin, provenance);
  assert.equal(snapshot.customScriptSource, original);
  const restored = lib.saveCustomIndicator(cleared.scripts, { ...cleared.script, catalogOrigin: cleared.script.versions[0].catalogOrigin }, { pinePrepared: prepared(original) });
  assert.deepEqual(restored.script.catalogOrigin, provenance);
  assert.equal(restored.script.versions.at(-1).catalogOrigin, undefined);
  const loaded = lib.sanitizeCustomIndicators(JSON.parse(JSON.stringify(restored.scripts)))[0];
  assert.deepEqual(loaded.catalogOrigin, provenance);
  assert.equal(loaded.versions.at(-1).catalogOrigin, undefined);
});

test("all 17 legacy sources can be viewed verbatim with pinned provenance without runtime eligibility", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    const prefix = `/catalog/pine/everget/${catalog.upstreamCommit}/`;
    assert.ok(url.startsWith(prefix));
    return new Response(readFileSync(path.join(sourceRoot, url.slice(prefix.length))));
  };
  try {
    const legacy = catalog.entries.filter((entry) => !lib.pineCatalogCanRun(entry));
    assert.equal(legacy.length, 17);
    for (const entry of legacy) {
      const loaded = await lib.loadPineCatalogSource(catalog, entry.id);
      assert.equal(loaded.source, source(entry));
      assert.deepEqual(loaded.provenance, origin(entry));
    }
  } finally { globalThis.fetch = previous; }
});

test("catalog import rejects a changed packaged source before exposing draft provenance", async () => {
  const entry = catalog.entries[0], previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(source(entry) + "\n// unverified asset change");
  try { await assert.rejects(lib.loadPineCatalogSource(catalog, entry.id), /pinned revision/); }
  finally { globalThis.fetch = previous; }
});


test("the pinned seed rejects altered source metadata even when its manifest and bytes agree", async () => {
  const entry = catalog.entries[0], modified = Buffer.from(source(entry) + "\n// substituted original");
  const forged = structuredClone(catalog);
  Object.assign(forged.entries[0], { sourceBytes: modified.length, sourceSha256: hash(modified),
    upstreamBlobSha1: createHash("sha1").update(`blob ${modified.length}\0`).update(modified).digest("hex") });
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    if (url.endsWith("index.json")) return new Response(JSON.stringify({ schemaVersion: 1, repository: catalog.repository, revisions: [catalog.upstreamCommit] }));
    if (url.endsWith("manifest.json")) return new Response(JSON.stringify(forged));
    return new Response(modified);
  };
  try {
    await assert.rejects(lib.loadPineCatalog(), /Pinned seed/);
    assert.equal(requests, 2);
    await assert.rejects(lib.loadPineCatalogSource(forged, entry.id), /Pinned seed/);
    assert.equal(requests, 2, "A forged pinned manifest must fail before reading source bytes.");
  } finally { globalThis.fetch = previous; }
  for (const change of [{ sourceBytes: entry.sourceBytes + 1 }, { sourceSha256: "0".repeat(64) }, { upstreamBlobSha1: "0".repeat(40) },
    { pineVersion: 5 }, { name: "Substituted title" }, { copyright: entry.copyright + " changed" }, { licenseNotice: entry.licenseNotice + " changed" }]) {
    const changed = structuredClone(catalog); Object.assign(changed.entries[0], change);
    assert.throws(() => lib.validatePineCatalogManifest(changed), /Pinned seed/);
  }
  assert.throws(() => lib.validatePineCatalogManifest({ ...catalog, licenseSha256: "0".repeat(64) }), /Pinned seed/);
});

test("empty-output seed refresh rejects substituted source or licence before publishing", async () => {
  for (const kind of ["source", "licence"]) {
    const output = path.join(directory, `forged-empty-seed-${kind}`);
    await assert.rejects(refreshPineCatalog({ commit: catalog.upstreamCommit, outputDir: output, fetchImpl: async (url) => {
      const response = await localFetch(url);
      if ((kind === "source" && url.endsWith(catalog.entries[0].path)) || (kind === "licence" && url.endsWith("/LICENSE"))) {
        return new Response(Buffer.concat([Buffer.from(await response.arrayBuffer()), Buffer.from("\n// substituted bytes")]));
      }
      return response;
    } }), /Fetched pinned seed/);
    assert.deepEqual(await readdir(output), [], "No revision, manifest, index or owned lock may survive the rejected refresh.");
  }
  const output = path.join(directory, "verified-empty-seed");
  const refreshed = await refreshPineCatalog({ commit: catalog.upstreamCommit, outputDir: output, fetchImpl: localFetch });
  assert.deepEqual(refreshed.entries, catalog.entries);
  assert.equal(refreshed.licenseSha256, catalog.licenseSha256);
  assert.doesNotThrow(() => lib.validatePineCatalogManifest(refreshed));
});
