import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [outputDir, mode] = process.argv.slice(2);
assert.ok(outputDir && ["delayed", "failed"].includes(mode));
const seedUrl = new URL("../../../frontend/src/lib/pineCatalogManifest.json", import.meta.url);
const seed = JSON.parse(await fs.readFile(seedUrl, "utf8"));
const sources = fileURLToPath(new URL(`../../../frontend/public/catalog/pine/everget/${seed.upstreamCommit}/`, import.meta.url));
const originalRead = fs.readFile;
let seedReads = 0;
let releaseSeed, signalSeed;
const gate = new Promise(resolve => { releaseSeed = resolve; });
const entered = new Promise(resolve => { signalSeed = resolve; });
fs.readFile = async (file, ...args) => {
  if (file instanceof URL && file.href === seedUrl.href) {
    seedReads++;
    if (seedReads === 1) {
      signalSeed();
      await gate;
      if (mode === "failed") throw new Error("Deliberate first seed read failure");
    }
  }
  return originalRead(file, ...args);
};
syncBuiltinESMExports();
const requests = [];
try {
  const { refreshPineCatalog } = await import("../../../scripts/refresh-pine-catalog.mjs");
  const fetchImpl = async url => {
    const prefix = `https://raw.githubusercontent.com/${seed.repository}/`;
    assert.ok(url.startsWith(prefix));
    const [commit, ...parts] = url.slice(prefix.length).split("/");
    assert.ok(["5".repeat(40), "6".repeat(40), "7".repeat(40)].includes(commit));
    const relative = parts.join("/");
    assert.ok(relative === "LICENSE" || seed.entries.some(entry => entry.path === relative));
    return new Response(readFileSync(path.join(sources, relative === "LICENSE" ? "LICENSE.txt" : relative)));
  };
  const run = commit => {
    const request = refreshPineCatalog({ commit, collection: "legacy-v1", outputDir, fetchImpl });
    requests.push(request);
    // Keep the intentional first rejection handled while the seed gate is held.
    void request.catch(() => {});
    return request;
  };
  run("5".repeat(40));
  await entered;
  run("6".repeat(40));
  const readsAfterSubmission = seedReads;
  releaseSeed();
  const results = await Promise.allSettled(requests);
  assert.equal(readsAfterSubmission, 1, "A later submission must wait before beginning its seed read");
  assert.equal(results[0].status, mode === "failed" ? "rejected" : "fulfilled");
  if (mode === "failed") assert.match(results[0].reason.message, /Deliberate first seed read failure/);
  assert.equal(results[1].status, "fulfilled");
  await run("7".repeat(40));
  const revisions = JSON.parse(await originalRead(path.join(outputDir, "index.json"), "utf8")).revisions;
  const expected = ["5".repeat(40), "6".repeat(40), "7".repeat(40)].slice(mode === "failed" ? 1 : 0);
  assert.deepEqual(revisions, [seed.upstreamCommit, ...expected]);
  for (const commit of expected) {
    const manifest = JSON.parse(await originalRead(path.join(outputDir, commit, "manifest.json"), "utf8"));
    assert.equal(manifest.upstreamCommit, commit);
  }
  assert.equal((await fs.readdir(outputDir)).includes(".refresh.lock"), false);
  process.stdout.write(JSON.stringify({ readsAfterSubmission, revisions }));
} finally {
  releaseSeed();
  await Promise.allSettled(requests);
  fs.readFile = originalRead;
  syncBuiltinESMExports();
}
