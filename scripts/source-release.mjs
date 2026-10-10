import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { readPineEngineSources } from "./pine-engine.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const exactFiles = new Set([
  "LICENSE", "THIRD_PARTY_NOTICES.md", "package.json", "package-lock.json", ".env.example", ".dockerignore",
  "docker-compose.yml", "docker-compose.local.yml", "docker-compose.efficient.yml",
  "frontend/package.json", "frontend/index.html", "frontend/Dockerfile", "frontend/vite.config.ts", "frontend/pineWorkerPlugin.ts",
  "frontend/tsconfig.json", "frontend/tsconfig.node.json", "frontend/tailwind.config.js", "frontend/postcss.config.js",
  "scripts/dev.js", "scripts/pine-engine.mjs", "scripts/pine-namespace-members101.mjs", "scripts/source-release.mjs", "scripts/purge-vite-cache.js", "scripts/refresh-pine-catalog.mjs",
  "backend/scripts/start_api.sh", "backend/scripts/migrate_sqlite_to_database.py", "backend/scripts/seed.py", "backend/scripts/import_market_data_to_db.py", "backend/scripts/refresh_session_summaries.py",
  "backend/Dockerfile", "backend/Dockerfile.node", "backend/requirements.txt", "backend/requirements-dev.txt", "backend/alembic.ini", "backend/index.js", "backend/db.js",
  "backend/auth/package.json", "backend/auth/Dockerfile",
]);
const trees = [
  ["frontend/src", /\.(?:ts|tsx|js|jsx|mjs|css|json|svg)$/],
  ["frontend/public", /\.(?:svg|png|jpe?g|webp|ico|css|js|json|pine|txt|woff2?|ttf)$/],
  ["frontend/vendor/pinets", /\.(?:ts|json|md)$/],
  ["backend/app", /\.py$/], ["backend/alembic", /\.(?:py|mako)$/],
  ["backend/routes", /\.js$/], ["backend/utils", /\.js$/],
  ["backend/auth", /\.mjs$/],
  ["docker", /(?:\.(?:conf|yml|yaml|json|sql|sh)|(?:^|\/)Dockerfile)$/],
];
const excludedFolders = new Set(["node_modules", "__pycache__", "uploads", "dist"]);
const privateJSON = /(?:^|[-_.])(?:credentials?|client_secret|oauth-client|secrets?)(?:[-_.]|$).*\.json$/i;
function relativeName(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9_./-]+$/.test(name) || name.startsWith("/") || name.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Unsafe source-release path.");
  return name;
}
function checkedPath(root, name) {
  relativeName(name);
  let current = root;
  for (const part of name.split("/")) {
    current = path.join(current, part);
    if (fs.existsSync(current) || fs.lstatSync(current, { throwIfNoEntry: false })) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Source release refuses symbolic links: ${name}`);
    }
  }
  return current;
}
function record(root, name) {
  const filename = checkedPath(root, name), stat = fs.statSync(filename);
  if (!stat.isFile()) throw new Error(`Source release expected a regular file: ${name}`);
  return { path: name, bytes: fs.readFileSync(filename), mode: stat.mode & 0o111 ? 0o755 : 0o644 };
}
/** Snapshot only runtime/build inputs. Never traverse private or generated trees. */
export function collectSourceFiles(rootDir) {
  const root = fs.realpathSync(rootDir), files = new Map();
  for (const name of exactFiles) {
    const filename = checkedPath(root, name);
    if (fs.existsSync(filename)) files.set(name, record(root, name));
  }
  function walk(name, extension) {
    const filename = checkedPath(root, name);
    if (!fs.existsSync(filename)) return;
    for (const entry of fs.readdirSync(filename, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || excludedFolders.has(entry.name) || privateJSON.test(entry.name)) continue;
      const child = name + "/" + entry.name;
      if (child === "frontend/public/source" || child === "frontend/vendor/pinets/upstream") continue;
      // Refuse links before deciding whether they are directories or files.
      checkedPath(root, child);
      if (entry.isDirectory()) walk(child, extension);
      else if (extension.test(child)) files.set(child, record(root, child));
    }
  }
  for (const [name, extension] of trees) walk(name, extension);
  return [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
const buildGuide = `# EdgeLab corresponding source

This is the application source captured for this build, licensed under AGPL-3.0-only.
SOURCE_MANIFEST.json identifies each included file. Credentials, trading records,
market datasets, generated bundles and Git history are intentionally excluded.

## Build the browser application

Install Node.js 22 and npm, then run:

    npm ci
    npm run build

The build verifies the pinned PineTS source inputs and reviewed overrides. Original
PineTS inputs are also included under frontend/vendor/pinets/upstream; npm ci installs
the version locked by package-lock.json. Dependencies retain their original licences.
The frontend build regenerates its source download from this working source.

## Run locally

Install Python 3.12. Create backend/.venv and install backend/requirements.txt:

    python3 -m venv backend/.venv
    backend/.venv/bin/pip install -r backend/requirements.txt

Copy .env.example to .env and set a fresh JWT secret. For local development select
EDGELAB_DEPLOYMENT_MODE=beta and VITE_DEPLOYMENT_MODE=beta. The local authentication
bypass is optional and loopback-only; it does not grant paid exports. Run npm run dev.
The UI is on port 5173 and the FastAPI service on port 8000. Supply your own dataset
folder and configure EDGELAB_DATASETS_ROOT when market data is required.

## Deploy

Docker Compose builds both application images from this source. Configure .env with
your own secrets, dataset path, Google account and Stripe settings. The supplied
main Compose defaults select production; local Compose explicitly selects beta.
Better Auth runs on Node 22.13+ with a separate durable authentication database.
Configure distinct BETTER_AUTH_SECRET and EDGELAB_AUTH_SERVICE_KEY values, the
exact public origin, and Google credentials. Register the Google redirect URI
at <public-origin>/api/better-auth/callback/google. Missing credentials leave
Google sign-in unavailable. Direct development uses legacy auth unless explicitly
enabled; node --env-file=.env scripts/dev.js loads local Better Auth configuration.
Live billing requires an activated merchant account and
live prices/credentials. Build and start with docker compose up --build -d. The web
service uses port 8080 by default. Do not expose local development bypass settings
or publish credentials. The optional legacy-node-api profile is retained.

See LICENSE, THIRD_PARTY_NOTICES.md and frontend/vendor/pinets/README.md for notices
and engine reconstruction details. Backend application code and database migration
sources are included. Application source access is separate from user data exports.
`;
function tarEntry(file) {
  const name = relativeName(file.path), bytes = Buffer.from(file.bytes), header = Buffer.alloc(512);
  let leaf = name, prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const split = name.split("/");
    leaf = split.pop(); prefix = split.join("/");
    if (Buffer.byteLength(leaf) > 100 || Buffer.byteLength(prefix) > 155) throw new Error("Source path exceeds the portable tar limit.");
  }
  header.write(leaf, 0, 100, "utf8");
  const octal = (value, at, length) => {
    const field = value.toString(8).padStart(length - 1, "0");
    if (field.length >= length) throw new Error("Source archive numeric field overflow.");
    header.write(field + "\0", at, length, "ascii");
  };
  octal(file.mode ?? 0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(bytes.length, 124, 12); octal(0, 136, 12);
  header.fill(32, 148, 156); header.write("0", 156); header.write("ustar\0", 257); header.write("00", 263); header.write(prefix, 345, 155);
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return [header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)];
}
function sourceSnapshot(rootDir) {
  const root = fs.realpathSync(rootDir), files = collectSourceFiles(root);
  for (const required of ["package.json", "package-lock.json", "LICENSE", "frontend/package.json", "frontend/vendor/pinets/manifest.json", "backend/requirements.txt"]) {
    if (!files.some(file => file.path === required)) throw new Error(`Missing source-release input: ${required}`);
  }
  const packageName = ["node_modules/pinets", "frontend/node_modules/pinets"].find(name => fs.existsSync(path.join(root, name)));
  if (!packageName) throw new Error("Install the locked Pine dependency before creating its source release.");
  const packageRoot = checkedPath(root, packageName), vendorRoot = checkedPath(root, "frontend/vendor/pinets");
  readPineEngineSources({ packageRoot, vendorRoot });
  const engine = JSON.parse(fs.readFileSync(path.join(vendorRoot, "manifest.json"), "utf8"));
  for (const name of ["package.json", "LICENSE", "dist/pinets.min.browser.es.js.map", ...engine.barrels.map(barrel => "dist/types/" + barrel.declaration)]) {
    const input = record(root, packageName + "/" + name);
    files.push({ ...input, path: "frontend/vendor/pinets/upstream/" + name });
  }
  files.push({ path: "BUILD.md", bytes: Buffer.from(buildGuide), mode: 0o644 }, ...["datasets/.gitkeep", "deployment/.gitkeep"].map(name => ({ path: name, bytes: Buffer.alloc(0), mode: 0o644 })));
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const entries = files.map(file => ({ path: file.path, size: file.bytes.length, mode: file.mode, sha256: digest(file.bytes) }));
  const contentHash = digest(JSON.stringify(entries));
  const sourceManifest = { schema: 1, contentHash, license: "AGPL-3.0-only", files: entries };
  // The embedded manifest describes every payload except itself, avoiding circular hashes.
  files.push({ path: "SOURCE_MANIFEST.json", bytes: Buffer.from(JSON.stringify(sourceManifest, null, 2) + "\n"), mode: 0o644 });
  const archive = gzipSync(Buffer.concat([...files.flatMap(tarEntry), Buffer.alloc(1024)]), { level: 9 });
  const archiveName = `edgelab-${contentHash.slice(0, 16)}-source.tar.gz`;
  const manifest = { ...sourceManifest, archive: { name: archiveName, size: archive.length, sha256: digest(archive) } };
  return { archiveName, archive, manifest };
}
export function writeSourceRelease({ rootDir, outputDir = path.join(rootDir, "frontend/public/source") }) {
  const root = fs.realpathSync(rootDir);
  const { archiveName, archive, manifest } = sourceSnapshot(root);
  // Preserve lexical paths beneath the caller's root before canonicalizing it;
  // macOS exposes the same temporary directory through /var and /private/var.
  const candidates = [path.relative(path.resolve(rootDir), path.resolve(outputDir)), path.relative(root, path.resolve(outputDir))];
  const relativeOutput = candidates.find(name => name && !path.isAbsolute(name) && name !== ".." && !name.startsWith(".." + path.sep))?.split(path.sep).join("/");
  const output = checkedPath(root, relativeOutput);
  if (relativeOutput !== "frontend/public/source" && trees.some(([name]) => relativeOutput === name || relativeOutput.startsWith(name + "/"))) throw new Error("Source output must stay outside collected input trees.");
  fs.mkdirSync(output, { recursive: true });
  const archivePath = checkedPath(root, relativeOutput + "/" + archiveName), manifestPath = checkedPath(root, relativeOutput + "/manifest.json"), indexPath = checkedPath(root, relativeOutput + "/index.html");
  fs.writeFileSync(archivePath, archive);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(indexPath, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>EdgeLab source code</title><style>body{margin:0;background:#0a1017;color:#edf4f7;font:16px/1.6 system-ui}main{max-width:42rem;margin:12vh auto;padding:2rem}h1{font-size:2.5rem;line-height:1.1;letter-spacing:-.05em}p{color:#acb9c4}a{color:#95eafa;text-underline-offset:.25em}a:focus-visible{outline:2px solid #95eafa;outline-offset:6px}.download{display:inline-block;background:#95eafa;color:#08141b;padding:.8rem 1.2rem;border-radius:.4rem;font-weight:650;text-decoration:none}code{overflow-wrap:anywhere;font-size:.8rem}nav{margin-top:2rem;display:flex;flex-wrap:wrap;gap:1.5rem}</style><main><h1>EdgeLab source code</h1><p>Download the application source for this build. It includes the code and instructions to build and run EdgeLab under the AGPL licence.</p><a class="download" href="${archiveName}" download>Download source</a><p>SHA-256<br><code>${manifest.archive.sha256}</code></p><nav><a href="manifest.json">File checksums</a><a href="/LICENSE.txt">Licence</a><a href="/THIRD_PARTY_NOTICES.txt">Third-party notices</a><a href="/">Back to EdgeLab</a></nav></main></html>\n`);
  // This reserved generated directory carries only the current build's offer.
  for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
    if (entry.isFile() && /^edgelab-[a-f0-9]{16}-source\.tar\.gz$/.test(entry.name) && entry.name !== archiveName) fs.unlinkSync(path.join(output, entry.name));
  }
  return { archiveName, archivePath, manifestPath, indexPath, manifest };
}
export function verifySourceRelease({ rootDir }) {
  const { manifest } = sourceSnapshot(rootDir);
  const offered = JSON.parse(fs.readFileSync(checkedPath(fs.realpathSync(rootDir), "frontend/public/source/manifest.json"), "utf8"));
  if (manifest.contentHash !== offered.contentHash || manifest.archive.sha256 !== offered.archive?.sha256) throw new Error("Application source changed during the build; rebuild to offer matching source.");
  const archive = fs.readFileSync(checkedPath(fs.realpathSync(rootDir), "frontend/public/source/" + manifest.archive.name));
  if (digest(archive) !== offered.archive.sha256) throw new Error("The generated source archive failed integrity verification.");
  return offered;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = fileURLToPath(new URL("../", import.meta.url));
  if (process.argv.includes("--verify")) {
    verifySourceRelease({ rootDir }); console.log("Matching application source verified after build.");
  } else {
    const result = writeSourceRelease({ rootDir }); console.log(`Matching application source prepared: ${result.archiveName}`);
  }
}
