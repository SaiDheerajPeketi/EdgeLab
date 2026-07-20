import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WIDTH = 3840;
const HEIGHT = 2160;
const manifestPath = join(ROOT, "manifest.json");
const jsxPath = join(ROOT, "ae", "edgelab-teaser-assets.jsx");
const htmlDir = join(ROOT, "html");

assertFile(manifestPath);
assertFile(jsxPath);

if (existsSync(htmlDir) && readdirSync(htmlDir).length > 0) {
  throw new Error("HTML capture output is not allowed for the AE asset pack");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.dimensions.width !== WIDTH || manifest.dimensions.height !== HEIGHT) {
  throw new Error(`Expected manifest dimensions ${WIDTH}x${HEIGHT}`);
}
if (!manifest.source.includes("actual EdgeLab React components")) {
  throw new Error("Manifest must identify actual EdgeLab React components as the source");
}
if (manifest.outputs.html) {
  throw new Error("Manifest must not advertise HTML output");
}

for (const scene of manifest.scenes) {
  const svgPath = join(ROOT, scene.svg);
  const pngPath = join(ROOT, scene.preview);
  assertFile(svgPath);
  assertFile(pngPath);

  const pngDimensions = readPngDimensions(pngPath);
  if (pngDimensions.width !== WIDTH || pngDimensions.height !== HEIGHT) {
    throw new Error(`${scene.id} PNG preview is ${pngDimensions.width}x${pngDimensions.height}, expected ${WIDTH}x${HEIGHT}`);
  }

  const svg = readFileSync(svgPath, "utf8");
  if (!svg.includes(`width="${WIDTH}"`) || !svg.includes(`height="${HEIGHT}"`)) {
    throw new Error(`${scene.id} SVG is not 4K UHD`);
  }
  for (const banned of ["<foreignObject", "xmlns=\"http://www.w3.org/1999/xhtml\"", "<div", "<style"]) {
    if (svg.includes(banned)) {
      throw new Error(`${scene.id} SVG contains browser markup instead of vector output: ${banned}`);
    }
  }
  if (!svg.includes("actual EdgeLab React component DOM capture")) {
    throw new Error(`${scene.id} SVG is not sourced from the actual app DOM capture`);
  }
  if (!svg.includes("data-role")) {
    throw new Error(`${scene.id} SVG is missing logical layer metadata`);
  }
  if ((scene.native_ae_layer_count ?? 0) <= 0) {
    throw new Error(`${scene.id} has no native AE-editable DOM layers`);
  }
}

const jsx = readFileSync(jsxPath, "utf8");
for (const banned of ["import ", "require(", "eval(", "<html", "<div"]) {
  if (jsx.includes(banned)) {
    throw new Error(`After Effects JSX should be plain ExtendScript and not include ${banned}`);
  }
}
for (const required of ["EdgeLab Actual App Components", "layers.addShape", "layers.addText", "Exact SVG imports"]) {
  if (!jsx.includes(required)) {
    throw new Error(`After Effects JSX is missing expected actual-app output: ${required}`);
  }
}

console.log(`Validated ${manifest.scenes.length} actual EdgeLab AE component captures at ${WIDTH}x${HEIGHT}.`);

function assertFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  if (statSync(path).size <= 0) {
    throw new Error(`Empty ${path}`);
  }
}

function readPngDimensions(path) {
  const header = readFileSync(path).subarray(0, 24);
  const signature = "89504e470d0a1a0a";
  if (header.subarray(0, 8).toString("hex") !== signature) {
    throw new Error(`${path} is not a PNG file`);
  }
  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}
