import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "everget/tradingview-pinescript-indicators";
const COLLECTIONS = {
  "legacy-v1": { seed: "pineCatalogManifest.json", root: "everget" },
  "expanded-v2": { seed: "pineCatalogManifestV2.json", root: "everget-v2" },
};
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const refreshQueues = new Map();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const blobSha = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

async function fetchBytes(url, fetchImpl, limit) {
  // Every URL is constructed internally from the one allowlisted repository.
  const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "EdgeLab-Pine-Catalog" } });
  if (!response.ok) throw new Error(`Upstream source unavailable (${response.status}).`);
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("Upstream response is oversized.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Upstream response has no readable body.");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new Error("Upstream response is oversized."); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

function sourceEntry(bytes, expected, commit) {
  const source = bytes.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(bytes)) throw new Error("Upstream source is not valid UTF-8.");
  if (!bytes.length || bytes.length > 20_000) throw new Error("Invalid immutable source size.");
  const lines = source.split(/\r?\n/).slice(0, 20);
  const copyright = lines.find((line) => /^[ \t]*\/\/.*Copyright.*Alex Orekhov \(everget\)/.test(line));
  const licenseNotice = lines.find((line) => /^[ \t]*\/\/.*GPL-3\.0/.test(line));
  const versions = [...source.matchAll(/^[ \t\uFEFF]*\/\/@version=(\d+)/gm)];
  const pineVersion = Number(versions[0]?.[1] ?? 1);
  if (!copyright || !licenseNotice || versions.length > 1 || !Number.isSafeInteger(pineVersion) || pineVersion < 1 || pineVersion > 6) throw new Error(`Author, licence or Pine version needs review: ${expected.path}`);
  const title = source.match(/(?:study|indicator)\s*\(\s*(?:title\s*=\s*)?(["'])(.+?)\1/)?.[2] ?? expected.name;
  if (!title || title.length > 160) throw new Error("Invalid Pine source title.");
  return { ...expected, name: title, copyright, licenseNotice, pineVersion, sourceBytes: bytes.length,
    sourceSha256: sha256(bytes), upstreamBlobSha1: blobSha(bytes), originUrl: `https://github.com/${REPOSITORY}/blob/${commit}/${expected.path}` };
}

function validateLicence(bytes) {
  const source = bytes.toString("utf8");
  if (!bytes.length || bytes.length > 100_000 || !Buffer.from(source, "utf8").equals(bytes)
    || !source.includes("GNU GENERAL PUBLIC LICENSE") || !source.includes("Version 3, 29 June 2007")) throw new Error("Upstream licence changed; review it before refreshing.");
}

async function withRefreshLock(outputDir, work) {
  await mkdir(outputDir, { recursive: true });
  const lock = path.join(outputDir, ".refresh.lock");
  const owner = randomUUID();
  try { await writeFile(lock, owner, { flag: "wx" }); }
  catch (cause) {
    if (cause.code === "EEXIST") throw new Error("Pine catalog refresh is busy in another process; retry after its lock is released.");
    throw cause;
  }
  try { return await work(); }
  finally {
    try { if (await readFile(lock, "utf8") === owner) await unlink(lock); }
    catch (cause) { if (cause.code !== "ENOENT") throw cause; }
  }
}

/** Updates catalog assets only. User scripts, versions and chart copies are never opened. */
export async function refreshPineCatalog({ commit, collection = "expanded-v2", outputDir, fetchImpl = fetch } = {}) {
  if (!Object.hasOwn(COLLECTIONS, collection)) throw new Error("Unknown Pine catalog collection.");
  const selected = COLLECTIONS[collection];
  const seed = JSON.parse(await readFile(new URL(`../frontend/src/lib/${selected.seed}`, import.meta.url), "utf8"));
  outputDir ??= fileURLToPath(new URL(`../frontend/public/catalog/pine/${selected.root}`, import.meta.url));
  if (commit !== undefined && (typeof commit !== "string" || !SHA.test(commit))) throw new Error("Commit must be a full lowercase 40-character Git SHA.");
  const root = path.resolve(outputDir);
  const previous = refreshQueues.get(root) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => withRefreshLock(root, () => refreshLocked({ commit, outputDir: root, fetchImpl, seed })));
  refreshQueues.set(root, pending);
  try { return await pending; }
  finally { if (refreshQueues.get(root) === pending) refreshQueues.delete(root); }
}

async function refreshLocked({ commit, outputDir, fetchImpl, seed }) {
  if (commit === undefined) {
    const ref = JSON.parse((await fetchBytes(`https://api.github.com/repos/${REPOSITORY}/git/ref/heads/master`, fetchImpl, 32_000)).toString("utf8"));
    commit = ref.object?.sha;
    if (ref.object?.type !== "commit" || typeof commit !== "string" || !SHA.test(commit)) throw new Error("Invalid upstream branch revision.");
  }
  let index;
  try { index = JSON.parse(await readFile(path.join(outputDir, "index.json"), "utf8")); }
  catch (cause) { if (cause.code !== "ENOENT") throw cause; index = { schemaVersion: 1, repository: REPOSITORY, revisions: [] }; }
  if (index.schemaVersion !== 1 || index.repository !== REPOSITORY || !Array.isArray(index.revisions) || index.revisions.length > 256 || index.revisions.some((value) => typeof value !== "string" || !SHA.test(value)) || new Set(index.revisions).size !== index.revisions.length) throw new Error("Invalid existing catalog revision index.");
  if (!index.revisions.includes(commit) && index.revisions.length >= 256) throw new Error("Pine catalog revision capacity is full.");
  const destination = path.join(outputDir, commit);
  let existing;
  try { existing = JSON.parse(await readFile(path.join(destination, "manifest.json"), "utf8")); }
  catch (cause) { if (cause.code !== "ENOENT") throw cause; }
  let manifest;
  if (existing !== undefined) {
    if (!existing || typeof existing !== "object" || existing.schemaVersion !== 1 || existing.repository !== REPOSITORY || existing.upstreamCommit !== commit
      || typeof existing.lastFetchedAt !== "string" || !Number.isFinite(Date.parse(existing.lastFetchedAt)) || !DIGEST.test(existing.licenseSha256)
      || !Array.isArray(existing.entries) || existing.entries.length !== seed.entries.length) throw new Error("Existing immutable revision is invalid.");
    const seen = new Set();
    for (const entry of existing.entries) {
      const expected = seed.entries.find((item) => item.path === entry?.path);
      if (!expected || seen.has(entry.path)) throw new Error("Existing immutable entry is invalid.");
      seen.add(entry.path);
      const verified = sourceEntry(await readFile(path.join(destination, expected.path)), expected, commit);
      if (Object.entries(verified).some(([key, value]) => entry[key] !== value)) throw new Error("Existing immutable source or metadata has changed.");
      if (commit === seed.upstreamCommit && Object.entries(expected).some(([key, value]) => verified[key] !== value)) throw new Error("Existing pinned seed source has changed.");
    }
    const licence = await readFile(path.join(destination, "LICENSE.txt"));
    validateLicence(licence);
    if (sha256(licence) !== existing.licenseSha256 || (commit === seed.upstreamCommit && existing.licenseSha256 !== seed.licenseSha256)) throw new Error("Existing immutable licence has changed.");
    manifest = existing;
  } else {
    const fetchedAt = new Date().toISOString();
    // Settle every bounded fetch before releasing the output lock on failure.
    const fetched = await Promise.allSettled(seed.entries.map(async (entry) => {
      const bytes = await fetchBytes(`https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${entry.path}`, fetchImpl, 20_000);
      const verified = sourceEntry(bytes, entry, commit);
      if (commit === seed.upstreamCommit && Object.entries(entry).some(([key, value]) => verified[key] !== value)) throw new Error("Fetched pinned seed source does not match the verified original.");
      return { bytes, entry: verified };
    }));
    const failure = fetched.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    const files = fetched.map((result) => result.value);
    const licence = await fetchBytes(`https://raw.githubusercontent.com/${REPOSITORY}/${commit}/LICENSE`, fetchImpl, 100_000);
    validateLicence(licence);
    if (commit === seed.upstreamCommit && sha256(licence) !== seed.licenseSha256) throw new Error("Fetched pinned seed licence does not match the verified original.");
    manifest = { schemaVersion: 1, repository: REPOSITORY, upstreamCommit: commit, lastFetchedAt: fetchedAt, licenseSha256: sha256(licence), entries: files.map((file) => file.entry) };
    const stage = path.join(outputDir, `.pending-${randomUUID()}`);
    await mkdir(stage);
    try {
      for (const file of files) {
        const target = path.join(stage, file.entry.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.bytes, { flag: "wx" });
      }
      await writeFile(path.join(stage, "LICENSE.txt"), licence, { flag: "wx" });
      await writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
      await rename(stage, destination); // Existing nonempty revision directories are never replaced.
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  if (!index.revisions.includes(commit)) {
    const indexFile = path.join(outputDir, `.index-${randomUUID()}.json`);
    const next = { ...index, revisions: [...index.revisions, commit] };
    try {
      await writeFile(indexFile, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
      await rename(indexFile, path.join(outputDir, "index.json"));
    } finally { await rm(indexFile, { force: true }); }
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    const key = flag === "--commit" ? "commit" : flag === "--collection" ? "collection" : null;
    if (!key || !value || options[key] !== undefined) throw new Error("Usage: node scripts/refresh-pine-catalog.mjs [--collection legacy-v1|expanded-v2] [--commit FULL_GIT_SHA]");
    options[key] = value;
  }
  const manifest = await refreshPineCatalog(options);
  process.stdout.write(`Pine catalog revision ${manifest.upstreamCommit}: ${manifest.entries.length} originals preserved. User scripts and chart copies are unchanged.\n`);
}
