import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SVG_DIR = join(ROOT, "svg");
const PREVIEW_DIR = join(ROOT, "preview");
const AE_DIR = join(ROOT, "ae");
const HTML_DIR = join(ROOT, "html");
const DIST_DIR = join(ROOT, "dist");
const SSR_DIR = join(ROOT, ".dist-ssr");
const WIDTH = 3840;
const HEIGHT = 2160;
const FPS = 30;
const DURATION = 7;

for (const dir of [SVG_DIR, PREVIEW_DIR, AE_DIR, HTML_DIR]) {
  mkdirSync(dir, { recursive: true });
}

runVite(["build", "--outDir", "dist"]);
runVite(["build", "--ssr", "src/static-render.jsx", "--outDir", ".dist-ssr"]);

const ssrEntry = findSsrEntry(SSR_DIR);
const { renderScenes } = await import(`${pathToFileURL(ssrEntry).href}?v=${Date.now()}`);
const scenes = renderScenes();
const css = readBuiltCss(DIST_DIR);

for (const scene of scenes) {
  const svgPath = join(SVG_DIR, `${scene.id}.svg`);
  const htmlPath = join(HTML_DIR, `${scene.id}.html`);
  const previewPath = join(PREVIEW_DIR, `${scene.id}.png`);
  writeFileSync(svgPath, renderSceneSvg(scene, css));
  writeFileSync(htmlPath, renderSceneHtml(scene, css));
  rasterizePreview(svgPath, previewPath, scene);
}

writeFileSync(join(ROOT, "manifest.json"), `${JSON.stringify(buildManifest(scenes), null, 2)}\n`);
writeFileSync(join(AE_DIR, "edgelab-teaser-assets.jsx"), buildAeScript(scenes));

console.log(`Exported ${scenes.length} actual EdgeLab component scenes to ${ROOT}`);

function runVite(args) {
  execFileSync("node", ["../../frontend/node_modules/vite/bin/vite.js", ...args], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function findSsrEntry(dir) {
  const direct = join(dir, "static-render.mjs");
  if (existsSync(direct)) return direct;
  const files = readdirSync(dir).filter((file) => file.endsWith(".mjs") || file.endsWith(".js"));
  if (files.length === 0) {
    throw new Error("Vite SSR build did not emit an entry module");
  }
  return join(dir, files[0]);
}

function readBuiltCss(dir) {
  const assetsDir = join(dir, "assets");
  if (!existsSync(assetsDir)) return "";
  return readdirSync(assetsDir)
    .filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(join(assetsDir, file), "utf8"))
    .join("\n");
}

function renderSceneSvg(scene, css) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="${scene.id}-title">
  <title id="${scene.id}-title">${escapeXml(scene.title)}</title>
  <metadata>${escapeXml(JSON.stringify({ id: scene.id, title: scene.title, source: "actual EdgeLab React components", sourceComponents: scene.sourceComponents }))}</metadata>
  <foreignObject width="${WIDTH}" height="${HEIGHT}" x="0" y="0">
    <div xmlns="http://www.w3.org/1999/xhtml">
      <style>${css.replaceAll("</style>", "<\\/style>")}</style>
      ${scene.html}
    </div>
  </foreignObject>
</svg>
`;
}

function buildManifest(scenes) {
  return {
    name: "EdgeLab AE Teaser Assets",
    version: "0.2.0",
    source: "actual EdgeLab React components rendered through Vite SSR",
    dimensions: { width: WIDTH, height: HEIGHT, label: "4K UHD" },
    fps: FPS,
    duration_seconds: DURATION,
    excluded: [
      "Marketing hero / product overview",
      "Sign-in / beta access screens",
      "videos/edgelab-beta-launch",
    ],
    outputs: {
      svg: "svg/{scene-id}.svg",
      html: "html/{scene-id}.html",
      preview: "preview/{scene-id}.png",
      after_effects_script: "ae/edgelab-teaser-assets.jsx",
    },
    capture: {
      method: "Vite SSR actual component render with compiled EdgeLab CSS inlined into SVG foreignObject",
      frame_component: "ActualAppSceneFrame",
    },
    scenes: scenes.map((scene, index) => ({
      id: scene.id,
      title: scene.title,
      sourceComponents: scene.sourceComponents,
      width: WIDTH,
      height: HEIGHT,
      import_order: index + 1,
      svg: `svg/${scene.id}.svg`,
      html: `html/${scene.id}.html`,
      preview: `preview/${scene.id}.png`,
    })),
  };
}

function renderSceneHtml(scene, css) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=3840, initial-scale=1" />
    <title>${escapeXml(scene.title)} - EdgeLab AE Component Capture</title>
    <style>
      html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #05070a; }
      ${css}
    </style>
  </head>
  <body>
    ${scene.html}
  </body>
</html>
`;
}

function buildAeScript(scenes) {
  const sceneJson = JSON.stringify(scenes.map((scene) => ({
    id: scene.id,
    title: scene.title,
    sourceComponents: scene.sourceComponents,
    svg: `svg/${scene.id}.svg`,
    preview: `preview/${scene.id}.png`,
  })), null, 2);

  return `/* EdgeLab AE Teaser Assets - actual app component captures
 * Imports rendered EdgeLab component compositions into After Effects.
 */
(function () {
  var WIDTH = ${WIDTH};
  var HEIGHT = ${HEIGHT};
  var FPS = ${FPS};
  var DURATION = ${DURATION};
  var scenes = ${sceneJson};
  var scriptFile = new File($.fileName);
  var rootFolderPath = scriptFile.parent.parent.fsName;

  app.beginUndoGroup("Import EdgeLab actual component captures");
  var project = app.project || app.newProject();
  var rootFolder = project.items.addFolder("EdgeLab Actual Component Captures");

  for (var i = 0; i < scenes.length; i += 1) {
    var scene = scenes[i];
    var comp = project.items.addComp("EdgeLab - " + scene.title, WIDTH, HEIGHT, 1, DURATION, FPS);
    comp.parentFolder = rootFolder;

    var pngFile = new File(rootFolderPath + "/" + scene.preview);
    if (pngFile.exists) {
      var pngItem = project.importFile(new ImportOptions(pngFile));
      pngItem.parentFolder = rootFolder;
      var pngLayer = comp.layers.add(pngItem);
      pngLayer.name = scene.id + " actual app preview";
      pngLayer.outPoint = DURATION;
    }

    var svgFile = new File(rootFolderPath + "/" + scene.svg);
    if (svgFile.exists) {
      var svgItem = project.importFile(new ImportOptions(svgFile));
      svgItem.parentFolder = rootFolder;
      var svgLayer = comp.layers.add(svgItem);
      svgLayer.name = scene.id + " actual app SVG composition";
      svgLayer.outPoint = DURATION;
      svgLayer.enabled = false;
    }

    var label = comp.layers.addText("Source components: " + scene.sourceComponents.join(", "));
    label.name = scene.id + " source component label";
    label.enabled = false;
    comp.markerProperty.setValueAtTime(0.5, new MarkerValue("Actual EdgeLab components: " + scene.sourceComponents.join(", ")));
  }

  app.endUndoGroup();
}());
`;
}

function rasterizePreview(svgPath, pngPath, scene) {
  try {
    execFileSync("/usr/bin/sips", ["-s", "format", "png", svgPath, "--out", pngPath], { stdio: "ignore" });
  } catch {
    writeFileSync(pngPath, fallbackPng(scene));
  }
}

function fallbackPng(scene) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  const bg = [5, 7, 10];
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = bg[0];
    pixels[index + 1] = bg[1];
    pixels[index + 2] = bg[2];
    pixels[index + 3] = 255;
  }
  return encodePng(WIDTH, HEIGHT, pixels);
}

function encodePng(width, height, rgba) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    scanlines[rowStart] = 0;
    rgba.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([u32(data.length), typeBuffer, data, u32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
