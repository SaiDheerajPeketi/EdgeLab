import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { collectSourceFiles, verifySourceRelease, writeSourceRelease } from "../../scripts/source-release.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function put(root, name, bytes) { const filename = path.join(root, name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes); return filename; }
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "edgelab-source81-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    "package.json": '{"name":"fixture","private":true,"type":"module","workspaces":["frontend"]}\n',
    "package-lock.json": '{"name":"fixture","lockfileVersion":3,"packages":{}}\n',
    "LICENSE": "GNU AFFERO GENERAL PUBLIC LICENSE fixture\n",
    "THIRD_PARTY_NOTICES.md": "Pinned engine and application source notices\n",
    ".env.example": "EDGELAB_JWT_SECRET=\nEDGELAB_DATASETS_ROOT=./datasets\n",
    "docker-compose.yml": "services: {}\n",
    "docker-compose.local.yml": "services: {}\n",
    ".dockerignore": "node_modules/\n.env\n",
    "frontend/package.json": '{"name":"frontend","private":true,"type":"module","dependencies":{"pinets":"0.11.0"}}\n',
    "frontend/src/main.tsx": "export const currentWorktree = 1;\n",
    "frontend/src/data/runtime.ts": "export const runtimeDataModule = true;\n",
    "frontend/src/source/parser.ts": "export const runtimeSourceModule = true;\n",
    "backend/app/data/format.py": "def format_record(value): return str(value)\n",
    "frontend/src/lib/config.json": '{"feature":"enabled"}\n',
    "frontend/public/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>\n',
    "frontend/public/LICENSE.txt": "Application licence\n",
    "frontend/public/THIRD_PARTY_NOTICES.txt": "Application notices\n",
    "frontend/public/catalog/pine/example/original.pine": '//@version=6\nindicator("Original")\nplot(close)\n',
    "frontend/Dockerfile": "FROM node:22-slim\n",
    "frontend/vite.config.ts": "export default {};\n",
    "frontend/tsconfig.json": '{"compilerOptions":{}}\n',
    "frontend/pineWorkerPlugin.ts": "export const worker = true;\n",
    "backend/requirements.txt": "fastapi==0.100.0\n",
    "backend/app/main.py": "app = object()\n",
    "backend/alembic/versions/001.py": "revision = '001'\n",
    "backend/scripts/start_api.sh": "#!/bin/sh\nexec python -m app.main\n",
    "backend/Dockerfile": "FROM python:3.12-slim\n",
    "backend/auth/package.json": '{"name":"edgelab-auth","private":true}\n',
    "backend/auth/Dockerfile": "FROM node:22-slim\n",
    "backend/auth/auth.mjs": "export const auth = 'matching-runtime';\n",
    "backend/auth/server.mjs": "export const serve = true;\n",
    "docker/nginx.conf": "server { listen 80; }\n",
    "scripts/dev.js": "console.log('dev');\n",
    "scripts/pine-engine.mjs": "export const pinned = true;\n",
    "scripts/pine-namespace-members101.mjs": "export const namespaceInventory = true;\n",
    "scripts/purge-vite-cache.js": "console.log('cache');\n",
    "scripts/source-release.mjs": "export const sourceOffer = true;\n",
  };
  for (const [name, bytes] of Object.entries(files)) await put(root, name, bytes);
  await chmod(path.join(root, "backend/scripts/start_api.sh"), 0o755);
  const engine = { version: "0.11.0", name: "pinets", type: "module" }, upstreamSource = "export class PineTS {}\n";
  const map = Buffer.from(JSON.stringify({ version: 3, sources: ["../src/PineTS.class.ts"], sourcesContent: [upstreamSource], names: [], mappings: "" }));
  await put(root, "node_modules/pinets/package.json", JSON.stringify(engine));
  await put(root, "node_modules/pinets/dist/pinets.min.browser.es.js.map", map);
  await put(root, "node_modules/pinets/LICENSE", "Upstream GNU AFFERO GENERAL PUBLIC LICENSE\n");
  const inventory = JSON.stringify({ schemaVersion: 1, version: "0.11.0", sourceMapSha256: sha256(map), namespaceSourcesSha256: sha256("[]"), overrides: [], namespaces: {}, membersSha256: sha256("{}") });
  await put(root, "frontend/vendor/pinets/namespace-members.json", inventory);
  files["frontend/vendor/pinets/namespace-members.json"] = inventory;
  const manifest = { version: "0.11.0", sourceMapSha256: sha256(map), barrels: [], overrides: [], namespaceMembers: { file: "namespace-members.json", sha256: sha256(inventory) } };
  await put(root, "frontend/vendor/pinets/manifest.json", JSON.stringify(manifest));
  files["frontend/vendor/pinets/manifest.json"] = JSON.stringify(manifest);
  return { root, files, map, upstreamSource };
}
function octal(bytes) { return parseInt(bytes.toString("ascii").replace(/\0/g, "").trim(), 8); }
function field(bytes) { return bytes.toString("utf8").split("\0", 1)[0]; }
// Independent ustar reader: validates raw records instead of using the writer's
// helpers or a shell archive tool. No archive entry is extracted to disk.
function readTar(gzip) {
  assert.equal(gzip[0], 0x1f); assert.equal(gzip[1], 0x8b);
  const tar = gunzipSync(gzip), entries = [];
  assert.equal(tar.length % 512, 0);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      assert.ok(tar.length - offset >= 1024, "Archive requires two final zero records");
      assert.ok(tar.subarray(offset).every((byte) => byte === 0));
      return entries;
    }
    const expected = octal(header.subarray(148, 156));
    let actual = 0;
    for (let index = 0; index < 512; index++) actual += index >= 148 && index < 156 ? 32 : header[index];
    assert.equal(actual, expected, "Each tar header checksum covers its actual bytes");
    assert.equal(field(header.subarray(257, 263)), "ustar");
    assert.equal(octal(header.subarray(108, 116)), 0, "Archive cannot contain a developer uid");
    assert.equal(octal(header.subarray(116, 124)), 0, "Archive cannot contain a developer gid");
    assert.equal(octal(header.subarray(136, 148)), 0, "Source timestamps are normalized");
    const prefix = field(header.subarray(345, 500)), name = field(header.subarray(0, 100)), full = prefix ? prefix + "/" + name : name;
    assert.ok(full && !full.startsWith("/") && !full.includes("\\") && !full.split("/").includes(".."), "Every member has a safe relative archive path");
    const type = String.fromCharCode(header[156]), size = octal(header.subarray(124, 136)), mode = octal(header.subarray(100, 108));
    assert.ok(type === "0" || type === "\0" || type === "5", "Source archives cannot contain links or special devices");
    assert.ok(mode === 0o644 || mode === 0o755, "Only normalized source permissions are published");
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    const bytes = tar.subarray(offset + 512, offset + 512 + size), padded = Math.ceil(size / 512) * 512;
    assert.equal(bytes.length, size);
    assert.ok(tar.subarray(offset + 512 + size, offset + 512 + padded).every((byte) => byte === 0), "File payload padding cannot contain stale bytes");
    entries.push({ path: full, bytes, type, mode });
    offset += 512 + padded;
  }
  assert.fail("Tar archive lacks its zero-record trailer");
}
function member(entries, relative) {
  const matches = entries.filter((entry) => entry.path === relative);
  assert.equal(matches.length, 1, relative + " must occur exactly once");
  return matches[0];
}

test("collector preserves current allowed file bytes including dirty changes without publishing excluded material", async (t) => {
  const f = await fixture(t), excluded = [".env", ".env.production", ".git/config", ".codex/private-plan.md", "docs/internal-launch-plan.md", "backend/data/customers.json", "backend/uploads/private.svg", "backend/app/customers.csv", "backend/app/database.sqlite", "frontend/dist/compiled.js", "frontend/node_modules/token.json", "frontend/src/roadmap.md", "frontend/public/source/old-source.tar.gz", "frontend/vendor/pinets/upstream/stale.ts", "scripts/private-launch-plan.mjs", "scripts/export-app-screens.mjs", "deployment/extract-config.sh", "deployment/instance-snapshots/accounts.json", "deployment/google-oauth-client.json", "datasets/EURUSD_M1.csv", "node_modules/other-package/package.json"];
  excluded.push("backend/auth/auth.db", "backend/auth/google-oauth-client.json", "backend/auth/.env", "backend/auth/node_modules/private.mjs");
  for (const name of excluded) await put(f.root, name, "PRIVATE_SENTINEL_81\n");
  const records = await collectSourceFiles(f.root), byPath = new Map(records.map((record) => [record.path, record]));
  for (const [name, bytes] of Object.entries(f.files)) {
    assert.ok(byPath.has(name), name + " is required build/run source");
    assert.ok(Buffer.isBuffer(byPath.get(name).bytes)); assert.deepEqual(byPath.get(name).bytes, Buffer.from(bytes));
  }
  for (const name of excluded) assert.ok(!byPath.has(name), name + " must not enter a public source snapshot");
  assert.ok(records.every((record) => !record.bytes.includes("PRIVATE_SENTINEL_81")));
  const changed = "export const currentWorktree = 2; // uncommitted change\n";
  await put(f.root, "frontend/src/main.tsx", changed);
  const after = await collectSourceFiles(f.root);
  assert.deepEqual(after.find((record) => record.path === "frontend/src/main.tsx").bytes, Buffer.from(changed), "Collection uses actual worktree bytes rather than HEAD or a stale cache");
});

test("included leaf symlinks and symlinked runtime ancestors are refused instead of copied", async (t) => {
  for (const ancestor of [false, true]) {
    const f = await fixture(t), outside = await mkdtemp(path.join(tmpdir(), "edgelab-source81-outside-"));
    t.after(() => rm(outside, { recursive: true, force: true }));
    await put(outside, "private.ts", "PRIVATE_SOURCE_81\n");
    const relative = ancestor ? "frontend/src" : "frontend/src/private.ts";
    if (ancestor) await rm(path.join(f.root, relative), { recursive: true });
    await symlink(ancestor ? outside : path.join(outside, "private.ts"), path.join(f.root, relative));
    await assert.rejects(async () => collectSourceFiles(f.root), /symlink|symbolic|link|unsafe/i);
    await assert.rejects(async () => writeSourceRelease({ rootDir: f.root, outputDir: path.join(f.root, "frontend/public/source") }), /symlink|symbolic|link|unsafe/i);
  }
});

test("unsafe backslash traversal names cannot become cross-platform archive paths", async (t) => {
  const f = await fixture(t);
  await put(f.root, "frontend/src/module\\..\\..\\private.ts", "PRIVATE_SOURCE_81\n");
  await assert.rejects(async () => collectSourceFiles(f.root), /path|unsafe|name|travers|backslash/i);
});

test("source archives are byte-deterministic across metadata changes and contain safe exact-byte ustar records", async (t) => {
  const f = await fixture(t), outputDir = path.join(f.root, "frontend/public/source");
  const longName = "frontend/src/" + "a".repeat(60) + "/" + "b".repeat(60) + "/model.ts", binary = Buffer.from([0, 255, 128, 10, 0, 1]);
  await put(f.root, longName, "export const nested = true;\n");
  await put(f.root, "frontend/public/logo.png", binary);
  const first = await writeSourceRelease({ rootDir: f.root, outputDir }), firstBytes = await readFile(first.archivePath), entries = readTar(firstBytes);
  assert.match(first.archiveName, /^edgelab-[0-9a-f]{16}-source\.tar\.gz$/);
  assert.equal(path.basename(first.archivePath), first.archiveName);
  assert.equal(new Set(entries.map((entry) => entry.path)).size, entries.length);
  for (const [name, bytes] of Object.entries(f.files)) assert.deepEqual(member(entries, name).bytes, Buffer.from(bytes));
  assert.deepEqual(member(entries, longName).bytes, Buffer.from("export const nested = true;\n"));
  assert.deepEqual(member(entries, "frontend/public/logo.png").bytes, binary);
  assert.ok(member(entries, "backend/scripts/start_api.sh").mode === 0o755);
  assert.deepEqual(member(entries, "frontend/vendor/pinets/upstream/dist/pinets.min.browser.es.js.map").bytes, f.map);
  assert.ok(member(entries, "frontend/vendor/pinets/upstream/LICENSE").bytes.includes("Upstream GNU"));
  assert.ok(member(entries, "BUILD.md").bytes.length > 0);
  assert.equal(member(entries, "datasets/.gitkeep").bytes.length, 0);
  assert.equal(member(entries, "deployment/.gitkeep").bytes.length, 0);
  await utimes(path.join(f.root, "frontend/src/main.tsx"), new Date("2001-01-01"), new Date("2030-01-01"));
  await mkdir(path.join(f.root, "frontend/src/empty-unused-directory"));
  const second = await writeSourceRelease({ rootDir: f.root, outputDir }), secondBytes = await readFile(second.archivePath);
  assert.equal(second.archiveName, first.archiveName); assert.deepEqual(secondBytes, firstBytes, "Timestamps, empty directories and prior generated output cannot change a source release");
  const altered = Buffer.from(firstBytes); altered[Math.floor(altered.length / 2)] ^= 1;
  assert.notEqual(sha256(altered), sha256(firstBytes), "Archive digest must detect changed archive bytes");
});

test("published index and manifests describe the exact downloadable archive without environment values", async (t) => {
  const f = await fixture(t), outputDir = path.join(f.root, "frontend/public/source"), original = process.env.EDGELAB_JWT_SECRET;
  process.env.EDGELAB_JWT_SECRET = "ENV_PRIVATE_SENTINEL_81";
  try {
    await put(f.root, ".env", "FILE_PRIVATE_SENTINEL_81\n");
    const release = await writeSourceRelease({ rootDir: f.root, outputDir }), archive = await readFile(release.archivePath), entries = readTar(archive);
    const external = JSON.parse(await readFile(release.manifestPath, "utf8")), inside = JSON.parse(member(entries, "SOURCE_MANIFEST.json").bytes.toString("utf8")), index = await readFile(release.indexPath, "utf8");
    assert.deepEqual(external, release.manifest);
    assert.ok(index.includes(release.archiveName), "Index links the artifact actually generated");
    assert.ok(/href=["'][^"']*manifest\.json["']/i.test(index));
    assert.ok(!index.includes("ENV_PRIVATE_SENTINEL_81") && !index.includes("FILE_PRIVATE_SENTINEL_81"));
    assert.ok(!gunzipSync(archive).includes("ENV_PRIVATE_SENTINEL_81") && !gunzipSync(archive).includes("FILE_PRIVATE_SENTINEL_81"));
    assert.ok(inside.files.length > 0);
    for (const file of inside.files) {
      const entry = member(entries, file.path);
      assert.equal(file.sha256, sha256(entry.bytes), file.path + " inventory hash matches its actual archive payload");
      assert.equal(file.size, entry.bytes.length);
    }
    // The external digest cannot be self-referential inside its own archive.
    assert.deepEqual(external.archive, { name: release.archiveName, size: archive.length, sha256: sha256(archive) });
    assert.deepEqual(external.files, inside.files);
    assert.equal(external.contentHash, sha256(JSON.stringify(inside.files)));
    assert.equal(external.contentHash, inside.contentHash);
    assert.ok(!JSON.stringify(inside).includes(sha256(archive)));
    const previous = release.archiveName;
    await put(f.root, "frontend/src/main.tsx", "export const currentWorktree = 99;\n");
    const next = await writeSourceRelease({ rootDir: f.root, outputDir });
    assert.notEqual(next.archiveName, previous, "Changed runtime source creates a new public content identity");
    const freshIndex = await readFile(next.indexPath, "utf8");
    assert.ok(freshIndex.includes(next.archiveName));
    await assert.rejects(readFile(release.archivePath), { code: "ENOENT" }, "The reserved offer directory retains only the current generated archive");
    assert.ok(!(await collectSourceFiles(f.root)).some((record) => record.path.startsWith("frontend/public/source/")));
  } finally {
    if (original === undefined) delete process.env.EDGELAB_JWT_SECRET;
    else process.env.EDGELAB_JWT_SECRET = original;
  }
});

test("writer refuses incomplete or mismatched upstream source inputs before publishing a source claim", async (t) => {
  const missing = await fixture(t);
  await rm(path.join(missing.root, "backend/requirements.txt"));
  await assert.rejects(async () => writeSourceRelease({ rootDir: missing.root, outputDir: path.join(missing.root, "frontend/public/source") }), /requirements|missing|required|complete/i);
  const modified = await fixture(t);
  await put(modified.root, "node_modules/pinets/dist/pinets.min.browser.es.js.map", modified.map.toString("utf8") + " ");
  await assert.rejects(async () => writeSourceRelease({ rootDir: modified.root, outputDir: path.join(modified.root, "frontend/public/source") }), /integrity|source map|hash|pinned/i);
  const wrongVersion = await fixture(t);
  await put(wrongVersion.root, "node_modules/pinets/package.json", '{"name":"pinets","version":"0.99.0"}');
  await assert.rejects(async () => writeSourceRelease({ rootDir: wrongVersion.root, outputDir: path.join(wrongVersion.root, "frontend/public/source") }), /version|reviewed|pinned/i);
});


test("postbuild verification refuses changed source and altered archive bytes", async (t) => {
  const f = await fixture(t), outputDir = path.join(f.root, "frontend/public/source");
  const first = writeSourceRelease({ rootDir: f.root, outputDir });
  assert.deepEqual(verifySourceRelease({ rootDir: f.root }), first.manifest);
  await put(f.root, "frontend/src/main.tsx", "export const changedDuringBuild = true;\n");
  assert.throws(() => verifySourceRelease({ rootDir: f.root }), /source changed|matching source|rebuild/i);
  const next = writeSourceRelease({ rootDir: f.root, outputDir });
  const archive = await readFile(next.archivePath); archive[archive.length - 5] ^= 1;
  await writeFile(next.archivePath, archive);
  assert.throws(() => verifySourceRelease({ rootDir: f.root }), /archive|integrity/i);
});

test("publisher refuses destinations outside the checkout, symlinked outputs and collected source trees", async (t) => {
  const f = await fixture(t), outside = await mkdtemp(path.join(tmpdir(), "edgelab-source81-output-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await put(outside, "manifest.json", "OUTSIDE_SENTINEL_81");
  assert.throws(() => writeSourceRelease({ rootDir: f.root, outputDir: outside }), /unsafe|path|outside/i);
  assert.throws(() => writeSourceRelease({ rootDir: f.root, outputDir: path.join(f.root, "frontend/src/generated") }), /collected|source output/i);
  await symlink(outside, path.join(f.root, "frontend/public/source"));
  assert.throws(() => writeSourceRelease({ rootDir: f.root }), /symlink|symbolic|link/i);
  assert.equal(await readFile(path.join(outside, "manifest.json"), "utf8"), "OUTSIDE_SENTINEL_81");
});


test("frontend-installed upstream declarations and reviewed overrides remain reconstructable in the download", async (t) => {
  const f = await fixture(t), declaration = "export * from './types';\n", override = "export class PineTS { localRevision = 81; }\n";
  const vendor = JSON.parse(f.files["frontend/vendor/pinets/manifest.json"]);
  vendor.barrels = [{ source: "src/types/index.ts", declaration: "index.d.ts", sha256: sha256(declaration) }];
  vendor.overrides = [{ source: "src/PineTS.class.ts", file: "overrides/PineTS.class.ts", upstreamSha256: sha256(f.upstreamSource), sha256: sha256(override) }];
  await put(f.root, "frontend/vendor/pinets/manifest.json", JSON.stringify(vendor));
  await put(f.root, "frontend/vendor/pinets/overrides/PineTS.class.ts", override);
  await put(f.root, "node_modules/pinets/dist/types/index.d.ts", declaration);
  await mkdir(path.join(f.root, "frontend/node_modules"), { recursive: true });
  await rename(path.join(f.root, "node_modules/pinets"), path.join(f.root, "frontend/node_modules/pinets"));
  const release = writeSourceRelease({ rootDir: f.root }), entries = readTar(await readFile(release.archivePath));
  assert.deepEqual(member(entries, "frontend/vendor/pinets/upstream/dist/types/index.d.ts").bytes, Buffer.from(declaration));
  assert.deepEqual(member(entries, "frontend/vendor/pinets/overrides/PineTS.class.ts").bytes, Buffer.from(override));
  assert.deepEqual(member(entries, "frontend/vendor/pinets/upstream/dist/pinets.min.browser.es.js.map").bytes, f.map, "Original upstream bytes remain separate from reviewed replacements");
  assert.deepEqual(JSON.parse(member(entries, "frontend/vendor/pinets/manifest.json").bytes.toString("utf8")), vendor);
  assert.ok(entries.every(entry => !entry.path.startsWith("node_modules/") && !entry.path.startsWith("frontend/node_modules/")));
  await put(f.root, "frontend/node_modules/pinets/dist/types/index.d.ts", declaration + "// modified\n");
  assert.throws(() => writeSourceRelease({ rootDir: f.root }), /barrel|integrity/i);
});

test("upstream package symlinks cannot publish files from outside the working checkout", async (t) => {
  const f = await fixture(t), outside = await mkdtemp(path.join(tmpdir(), "edgelab-source81-engine-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await put(outside, "LICENSE", "PRIVATE_UPSTREAM_SENTINEL_81");
  await rm(path.join(f.root, "node_modules/pinets/LICENSE"));
  await symlink(path.join(outside, "LICENSE"), path.join(f.root, "node_modules/pinets/LICENSE"));
  assert.throws(() => writeSourceRelease({ rootDir: f.root }), /symlink|symbolic|link/i);
  await rm(path.join(f.root, "node_modules/pinets"), { recursive: true });
  await symlink(outside, path.join(f.root, "node_modules/pinets"));
  assert.throws(() => writeSourceRelease({ rootDir: f.root }), /symlink|symbolic|link/i);
});
