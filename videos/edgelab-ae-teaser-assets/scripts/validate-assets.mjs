import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScenes, SCENE_HEIGHT, SCENE_WIDTH } from "../src/scene-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const scenes = buildScenes();
const manifestPath = join(ROOT, "manifest.json");
const jsxPath = join(ROOT, "ae", "edgelab-teaser-assets.jsx");

assertFile(manifestPath);
assertFile(jsxPath);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.dimensions.width !== SCENE_WIDTH || manifest.dimensions.height !== SCENE_HEIGHT) {
  throw new Error(`Expected manifest dimensions ${SCENE_WIDTH}x${SCENE_HEIGHT}`);
}

for (const scene of scenes) {
  const svgPath = join(ROOT, "svg", `${scene.id}.svg`);
  const htmlPath = join(ROOT, "html", `${scene.id}.html`);
  const pngPath = join(ROOT, "preview", `${scene.id}.png`);
  assertFile(svgPath);
  assertFile(htmlPath);
  assertFile(pngPath);
  const pngDimensions = readPngDimensions(pngPath);
  if (pngDimensions.width !== SCENE_WIDTH || pngDimensions.height !== SCENE_HEIGHT) {
    throw new Error(`${scene.id} PNG preview is ${pngDimensions.width}x${pngDimensions.height}, expected ${SCENE_WIDTH}x${SCENE_HEIGHT}`);
  }
  const svg = readFileSync(svgPath, "utf8");
  if (!svg.includes(`width="${SCENE_WIDTH}"`) || !svg.includes(`height="${SCENE_HEIGHT}"`)) {
    throw new Error(`${scene.id} SVG is not 4K UHD`);
  }
  if (svg.includes("Marketing hero") || svg.includes("Sign-in") || svg.includes("beta access")) {
    throw new Error(`${scene.id} includes an excluded surface`);
  }
  const html = readFileSync(htmlPath, "utf8");
  if (!html.includes("actual-scene-frame") || !html.includes("data-actual-component-scene")) {
    throw new Error(`${scene.id} HTML is not an actual component composition`);
  }
}

const jsx = readFileSync(jsxPath, "utf8");
for (const banned of ["import ", "require(", "eval("]) {
  if (jsx.includes(banned)) {
    throw new Error(`After Effects JSX should be plain ExtendScript and not include ${banned}`);
  }
}

console.log(`Validated ${scenes.length} EdgeLab AE teaser scenes at ${SCENE_WIDTH}x${SCENE_HEIGHT}.`);

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
