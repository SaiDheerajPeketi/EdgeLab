import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));
const frontendPackage = JSON.parse(await readFile(path.join(repository, "frontend/package.json"), "utf8"));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

// Use the real optimizer, production bundler and npm lifecycle. The source-offer
// verifier alone is a fixture boundary; its invocation is independently required.
test("a production build preserves a running Vite dependency cache and its served modules", { timeout: 60_000 }, async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "edgelab-build-cache117-")));
  const frontend = path.join(root, "frontend"), scripts = path.join(root, "scripts");
  await mkdir(path.join(frontend, "node_modules"), { recursive: true });
  await mkdir(scripts);
  let server;
  t.after(async () => { await server?.close(); await rm(root, { recursive: true, force: true }); });
  for (const dependency of ["react", "react-dom", "scheduler"]) {
    await symlink(path.dirname(require.resolve(dependency + "/package.json")), path.join(frontend, "node_modules", dependency), "dir");
  }
  const viteCli = path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await writeFile(path.join(frontend, "package.json"), JSON.stringify({
    name: "edgelab-build-cache117", private: true, type: "module",
    scripts: { build: `${quote(process.execPath)} ${quote(viteCli)} build`, postbuild: frontendPackage.scripts.postbuild },
  }));
  await writeFile(path.join(scripts, "purge-vite-cache.js"), await readFile(path.join(repository, "scripts/purge-vite-cache.js")));
  await writeFile(path.join(scripts, "source-release.mjs"), `import assert from "node:assert/strict";\nimport {readFileSync} from "node:fs";\nassert.deepEqual(process.argv.slice(2),["--verify"]);\nassert.match(readFileSync(new URL("../frontend/dist/index.html",import.meta.url),"utf8"),/assets\\//);\nconsole.log("SOURCE_VERIFICATION117_EXECUTED");\n`);
  await writeFile(path.join(frontend, "index.html"), '<!doctype html><div id="root"></div><script type="module" src="/main.js"></script>');
  await writeFile(path.join(frontend, "main.js"), 'import React from "react"; import {createRoot} from "react-dom/client"; createRoot(document.getElementById("root")).render(React.createElement("p",null,"Live cache"));');

  // Vite treats port 0 as its default port. Ask the OS for an isolated free port.
  const reservation = createNetServer();
  await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  server = await createServer({
    configFile: false, root: frontend, logLevel: "silent",
    optimizeDeps: { include: ["react", "react-dom/client"] },
    server: { host: "127.0.0.1", port, strictPort: true },
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const main = await fetch(new URL("main.js", origin), { signal: AbortSignal.timeout(10_000) });
  assert.equal(main.status, 200);
  const transformed = await main.text();
  const urls = [...transformed.matchAll(/["'](\/node_modules\/\.vite\/deps\/[^"']+\.js\?v=[^"']+)["']/g)].map(match => new URL(match[1], origin));
  assert.ok(urls.length >= 2, "Real React and ReactDOM imports must use the live dependency optimizer: " + transformed);
  const before = [];
  for (const url of urls) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    const bytes = await readFile(path.join(frontend, url.pathname.slice(1)));
    const served = await response.text();
    assert.ok(served.length > 0, "The live optimized dependency must have a served module body");
    before.push({ bytes, served });
  }
  const metadataPath = path.join(frontend, "node_modules/.vite/deps/_metadata.json");
  const metadata = await readFile(metadataPath);

  const built = await run("npm", ["run", "build", "--silent"], {
    cwd: frontend, timeout: 30_000, maxBuffer: 64_000,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  assert.match(built.stdout, /SOURCE_VERIFICATION117_EXECUTED/, "The retained postbuild source verification must execute");
  assert.match(await readFile(path.join(frontend, "dist/index.html"), "utf8"), /assets\//);
  assert.deepEqual(await readFile(metadataPath), metadata, "Production build must preserve the active optimizer metadata");
  for (let index = 0; index < urls.length; index++) {
    assert.deepEqual(await readFile(path.join(frontend, urls[index].pathname.slice(1))), before[index].bytes, "Production build must preserve each cached optimized module");
    const response = await fetch(urls[index], { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, "The same live optimized dependency URL must remain usable after the build");
    assert.equal(await response.text(), before[index].served, "Production build must preserve the served dependency transformation");
  }
});
