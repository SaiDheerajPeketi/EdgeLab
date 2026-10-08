import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { verifyNamespaceMembers } from "./pine-namespace-members101.mjs";

const require = createRequire(import.meta.url);
const vendorRoot = fileURLToPath(new URL("../frontend/vendor/pinets/", import.meta.url));
const namespace = "edgelab-pine-source";
const digest = value => createHash("sha256").update(value).digest("hex");
const safeSource = value => typeof value === "string" && /^src\/[A-Za-z0-9_./-]+\.ts$/.test(value) && path.posix.normalize(value) === value && !value.includes("/../");

/** Rebuild the exact pinned sources, with reviewed local overrides. No package
 * mutation, source rewriting of user scripts, network fetch or disk fallback. */
export function readPineEngineSources({ packageRoot, vendorRoot, patched = true, namespaceMembers = true }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(vendorRoot, "manifest.json"), "utf8"));
  const installed = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  if (installed.version !== manifest.version) throw new Error("The reviewed Pine engine version does not match the installed package.");
  const mapBytes = fs.readFileSync(path.join(packageRoot, "dist/pinets.min.browser.es.js.map"));
  if (digest(mapBytes) !== manifest.sourceMapSha256) throw new Error("The pinned Pine engine source map failed integrity verification.");
  const map = JSON.parse(mapBytes.toString("utf8"));
  const sources = new Map();
  for (let index = 0; index < map.sources.length; index++) {
    const original = map.sources[index], contents = map.sourcesContent[index];
    if (typeof contents !== "string" || typeof original !== "string" || !original.startsWith("../")) throw new Error("Invalid pinned Pine engine source entry.");
    const name = original.slice(3);
    if (!safeSource(name) && !["node_modules/acorn/dist/acorn.mjs", "node_modules/acorn-walk/dist/walk.mjs", "node_modules/astring/dist/astring.mjs"].includes(name)) throw new Error("Unrecognized pinned Pine source path.");
    if (sources.has(name)) throw new Error("Duplicate pinned Pine source path.");
    sources.set(name, contents);
  }
  // This type barrel is omitted by the upstream source map after tree shaking.
  // Its installed declaration contains only the original re-exports.
  for (const barrel of manifest.barrels) {
    if (!safeSource(barrel.source) || sources.has(barrel.source) || !/^[A-Za-z0-9_.-]+\.d\.ts$/.test(barrel.declaration)) throw new Error("Invalid Pine source barrel.");
    const contents = fs.readFileSync(path.join(packageRoot, "dist/types", barrel.declaration));
    if (digest(contents) !== barrel.sha256) throw new Error("The pinned Pine source barrel failed integrity verification.");
    sources.set(barrel.source, contents.toString("utf8"));
  }
  const seen = new Set();
  for (const override of manifest.overrides) {
    if (!safeSource(override.source) || seen.has(override.source) || !sources.has(override.source) || digest(sources.get(override.source)) !== override.upstreamSha256) throw new Error("Invalid or outdated Pine source override.");
    seen.add(override.source);
    if (!patched) continue;
    const expected = "overrides/" + override.source.slice(4);
    if (override.file !== expected) throw new Error("Pine source overrides must stay in their reviewed directory.");
    const filename = path.join(vendorRoot, expected);
    if (!fs.realpathSync(filename).startsWith(fs.realpathSync(vendorRoot) + path.sep)) throw new Error("Pine source override escaped its reviewed directory.");
    const contents = fs.readFileSync(filename);
    if (digest(contents) !== override.sha256) throw new Error("The reviewed Pine source override failed integrity verification.");
    sources.set(override.source, contents.toString("utf8"));
  }
  if (patched && namespaceMembers) {
    const metadata = manifest.namespaceMembers;
    if (metadata?.file !== "namespace-members.json" || !/^[a-f0-9]{64}$/.test(metadata.sha256 ?? "")) throw new Error("Invalid reviewed Pine namespace inventory.");
    const filename = path.join(vendorRoot, metadata.file);
    if (!fs.realpathSync(filename).startsWith(fs.realpathSync(vendorRoot) + path.sep)) throw new Error("Pine namespace inventory escaped its reviewed directory.");
    const contents = fs.readFileSync(filename);
    if (digest(contents) !== metadata.sha256) throw new Error("The reviewed Pine namespace inventory failed integrity verification.");
    const members = verifyNamespaceMembers(JSON.parse(contents), sources, manifest);
    const compact = Object.fromEntries(Object.entries(members).map(([name, values]) => [name, " " + values.join(" ") + " "]));
    sources.set("src/transpiler/pineToJS/inputs/edgelabNamespaceMembers.ts", "const members: Record<string, string> = " + JSON.stringify(compact) + ";\nexport const pineNamespaceHasMember = (namespace: string, member: string): boolean => members[namespace]?.includes(\" \" + member + \" \") ?? false;\n");
  }
  return sources;
}

export function createPineEnginePlugin({ patched = true } = {}) {
  const packageRoot = path.dirname(path.dirname(require.resolve("pinets")));
  const sources = readPineEngineSources({ packageRoot, vendorRoot, patched });
  const entry = 'export { default as PineTS } from "./PineTS.class"; export { Indicator } from "./Indicator"; export { Context } from "./Context.class"; export { Series } from "./Series"; export { computeNextPeriodStart } from "./marketData/types";';
  sources.set("src/edgelab-entry.ts", entry);
  const dependency = { acorn: "node_modules/acorn/dist/acorn.mjs", "acorn-walk": "node_modules/acorn-walk/dist/walk.mjs", astring: "node_modules/astring/dist/astring.mjs" };
  return {
    name: "edgelab-reviewed-pine-engine",
    setup(build) {
      build.initialOptions.tsconfigRaw ??= { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } };
      build.onResolve({ filter: /^pinets$/ }, () => ({ path: "src/edgelab-entry.ts", namespace }));
      build.onResolve({ filter: /.*/, namespace }, args => {
        let name;
        if (Object.prototype.hasOwnProperty.call(dependency, args.path)) name = dependency[args.path];
        else if (args.path.startsWith("@pinets/")) name = "src/" + args.path.slice(8);
        else if (args.path.startsWith(".")) name = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path));
        else throw new Error("Unrecognized Pine source import: " + args.path);
        const target = [name, name + ".ts", name + "/index.ts", name + ".mjs"].find(candidate => sources.has(candidate));
        if (!target) throw new Error("Pinned Pine source import is missing: " + name);
        return { path: target, namespace };
      });
      build.onLoad({ filter: /.*/, namespace }, args => ({ contents: sources.get(args.path), loader: args.path.endsWith(".mjs") ? "js" : "ts" }));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createPineEnginePlugin();
  console.log("Reviewed Pine engine source integrity verified.");
}
