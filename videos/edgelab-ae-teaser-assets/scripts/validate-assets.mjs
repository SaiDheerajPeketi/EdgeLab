import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScenes, SCENE_HEIGHT, SCENE_WIDTH } from "../src/scene-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const scenes = buildScenes();
const manifestPath = join(ROOT, "manifest.json");
const jsxPath = join(ROOT, "ae", "edgelab-teaser-assets.jsx");
const htmlDir = join(ROOT, "html");

assertFile(manifestPath);
assertFile(jsxPath);

if (existsSync(htmlDir) && readdirSync(htmlDir).length > 0) {
  throw new Error("HTML capture output is not allowed for the editable AE asset pack");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.dimensions.width !== SCENE_WIDTH || manifest.dimensions.height !== SCENE_HEIGHT) {
  throw new Error(`Expected manifest dimensions ${SCENE_WIDTH}x${SCENE_HEIGHT}`);
}
if (manifest.outputs.html) {
  throw new Error("Manifest must not advertise HTML output");
}

for (const scene of scenes) {
  const svgPath = join(ROOT, "svg", `${scene.id}.svg`);
  const pngPath = join(ROOT, "preview", `${scene.id}.png`);
  assertFile(svgPath);
  assertFile(pngPath);

  const pngDimensions = readPngDimensions(pngPath);
  if (pngDimensions.width !== SCENE_WIDTH || pngDimensions.height !== SCENE_HEIGHT) {
    throw new Error(`${scene.id} PNG preview is ${pngDimensions.width}x${pngDimensions.height}, expected ${SCENE_WIDTH}x${SCENE_HEIGHT}`);
  }

  const svg = readFileSync(svgPath, "utf8");
  if (!svg.includes(`width="${SCENE_WIDTH}"`) || !svg.includes(`height="${SCENE_HEIGHT}"`)) {
    throw new Error(`${scene.id} SVG is not 4K UHD`);
  }
  for (const banned of ["<foreignObject", "xmlns=\"http://www.w3.org/1999/xhtml\"", "<div", "<style"]) {
    if (svg.includes(banned)) {
      throw new Error(`${scene.id} SVG contains non-editable browser/HTML markup: ${banned}`);
    }
  }
  if (!svg.includes("data-layer-type") || !svg.includes("data-role")) {
    throw new Error(`${scene.id} SVG is missing logical layer metadata`);
  }
  if (svg.includes("Marketing hero") || svg.includes("Sign-in") || svg.includes("beta access")) {
    throw new Error(`${scene.id} includes an excluded surface`);
  }
}

const jsx = readFileSync(jsxPath, "utf8");
for (const banned of ["import ", "require(", "eval(", "foreignObject", "<html", "<div"]) {
  if (jsx.includes(banned)) {
    throw new Error(`After Effects JSX should be plain ExtendScript and not include ${banned}`);
  }
}
for (const required of ["layers.addShape", "layers.addText", "ADBE Vector Shape"]) {
  if (!jsx.includes(required)) {
    throw new Error(`After Effects JSX is missing editable AE layer creation: ${required}`);
  }
}

console.log(`Validated ${scenes.length} editable EdgeLab AE component scenes at ${SCENE_WIDTH}x${SCENE_HEIGHT}.`);

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
