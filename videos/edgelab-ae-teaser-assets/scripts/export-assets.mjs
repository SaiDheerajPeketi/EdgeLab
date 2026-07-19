import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { buildScenes, COLORS, DURATION_SECONDS, FPS, SCENE_HEIGHT, SCENE_WIDTH, renderSceneSvg } from "../src/scene-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SVG_DIR = join(ROOT, "svg");
const PREVIEW_DIR = join(ROOT, "preview");
const AE_DIR = join(ROOT, "ae");

for (const dir of [SVG_DIR, PREVIEW_DIR, AE_DIR]) {
  mkdirSync(dir, { recursive: true });
}

const scenes = buildScenes();

for (const scene of scenes) {
  const svgPath = join(SVG_DIR, `${scene.id}.svg`);
  const previewPath = join(PREVIEW_DIR, `${scene.id}.png`);
  writeFileSync(svgPath, renderSceneSvg(scene));
  rasterizePreview(svgPath, previewPath, scene);
}

writeFileSync(join(ROOT, "manifest.json"), `${JSON.stringify(buildManifest(scenes), null, 2)}\n`);
writeFileSync(join(AE_DIR, "edgelab-teaser-assets.jsx"), buildAeScript(scenes));

console.log(`Exported ${scenes.length} 4K AE teaser scenes to ${ROOT}`);

function buildManifest(items) {
  return {
    name: "EdgeLab AE Teaser Assets",
    version: "0.1.0",
    dimensions: {
      width: SCENE_WIDTH,
      height: SCENE_HEIGHT,
      label: "4K UHD",
    },
    fps: FPS,
    duration_seconds: DURATION_SECONDS,
    excluded: [
      "Marketing hero / product overview",
      "Sign-in / beta access screens",
      "videos/edgelab-beta-launch",
    ],
    outputs: {
      svg: "svg/{scene-id}.svg",
      preview: "preview/{scene-id}.png",
      after_effects_script: "ae/edgelab-teaser-assets.jsx",
    },
    colors: COLORS,
    fonts: ["Inter", "Syne", "JetBrains Mono"],
    scenes: items.map((scene, index) => ({
      id: scene.id,
      title: scene.title,
      width: scene.width,
      height: scene.height,
      fps: scene.fps,
      duration_seconds: scene.durationSeconds,
      import_order: index + 1,
      svg: `svg/${scene.id}.svg`,
      preview: `preview/${scene.id}.png`,
      layers: scene.layers.map((item) => ({
        id: item.id,
        role: item.role,
        type: item.type,
        name: titleCase(item.id),
        suggested_animation: animationForRole(item.role),
      })),
    })),
  };
}

function animationForRole(role) {
  if (role?.includes("background")) return "slow opacity fade, 0-18 frames";
  if (role === "title" || role === "subtitle") return "masked text reveal, 8-28 frames";
  if (role?.includes("chart") || role?.includes("candle") || role?.includes("bar") || role?.includes("heatmap")) return "stroke/scale reveal, 12-45 frames";
  if (role?.includes("metric") || role?.includes("badge")) return "pop-in with 4px vertical settle, 16-32 frames";
  if (role?.includes("table")) return "row stagger, 3 frames per row";
  return "opacity and position reveal, 10-24 frames";
}

function rasterizePreview(svgPath, pngPath, scene) {
  try {
    execFileSync("/usr/bin/sips", ["-s", "format", "png", svgPath, "--out", pngPath], { stdio: "ignore" });
  } catch {
    writeFileSync(pngPath, fallbackPng(scene));
  }
}

function fallbackPng(scene) {
  const width = SCENE_WIDTH;
  const height = SCENE_HEIGHT;
  const pixels = Buffer.alloc(width * height * 4);
  const bg = hexToRgb(COLORS.bg);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = bg[0];
    pixels[index + 1] = bg[1];
    pixels[index + 2] = bg[2];
    pixels[index + 3] = 255;
  }
  for (const item of scene.layers) {
    if (item.type !== "rect" || !item.fill) continue;
    const [r, g, b] = hexToRgb(item.fill);
    const x0 = Math.max(0, Math.round((item.x / SCENE_WIDTH) * width));
    const y0 = Math.max(0, Math.round((item.y / SCENE_HEIGHT) * height));
    const x1 = Math.min(width, Math.round(((item.x + item.width) / SCENE_WIDTH) * width));
    const y1 = Math.min(height, Math.round(((item.y + item.height) / SCENE_HEIGHT) * height));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = r;
        pixels[offset + 1] = g;
        pixels[offset + 2] = b;
        pixels[offset + 3] = 255;
      }
    }
  }
  return encodePng(width, height, pixels);
}

function buildAeScript(items) {
  const sceneJson = JSON.stringify(items.map((scene) => ({
    id: scene.id,
    title: scene.title,
    layers: scene.layers.filter((item) => ["rect", "circle", "text"].includes(item.type)).map((item) => ({
      id: item.id,
      type: item.type,
      role: item.role,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      rx: item.rx,
      cx: item.cx,
      cy: item.cy,
      r: item.r,
      fill: item.fill,
      stroke: item.stroke,
      strokeWidth: item.strokeWidth,
      text: item.text,
      size: item.size,
      weight: item.weight,
      font: item.font,
    })),
  })), null, 2);

  return `/* EdgeLab AE Teaser Assets
 * Generated by videos/edgelab-ae-teaser-assets/scripts/export-assets.mjs
 * Creates native AE comps with editable shape and text layers.
 */
(function () {
  var WIDTH = ${SCENE_WIDTH};
  var HEIGHT = ${SCENE_HEIGHT};
  var FPS = ${FPS};
  var DURATION = ${DURATION_SECONDS};
  var scenes = ${sceneJson};

  function hexToRgb(hex) {
    var clean = String(hex || "#ffffff").replace("#", "");
    if (clean.length === 3) {
      clean = clean.charAt(0) + clean.charAt(0) + clean.charAt(1) + clean.charAt(1) + clean.charAt(2) + clean.charAt(2);
    }
    return [
      parseInt(clean.substr(0, 2), 16) / 255,
      parseInt(clean.substr(2, 2), 16) / 255,
      parseInt(clean.substr(4, 2), 16) / 255
    ];
  }

  function addRect(comp, item) {
    var layer = comp.layers.addShape();
    layer.name = item.id + " [" + item.role + "]";
    var contents = layer.property("ADBE Root Vectors Group");
    var group = contents.addProperty("ADBE Vector Group");
    var vectors = group.property("ADBE Vectors Group");
    var rect = vectors.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue([item.width || 1, item.height || 1]);
    rect.property("ADBE Vector Rect Position").setValue([0, 0]);
    rect.property("ADBE Vector Rect Roundness").setValue(item.rx || 0);
    var fill = vectors.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue(hexToRgb(item.fill));
    if (item.stroke) {
      var stroke = vectors.addProperty("ADBE Vector Graphic - Stroke");
      stroke.property("ADBE Vector Stroke Color").setValue(hexToRgb(item.stroke));
      stroke.property("ADBE Vector Stroke Width").setValue(item.strokeWidth || 2);
    }
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([(item.x || 0) + (item.width || 0) / 2, (item.y || 0) + (item.height || 0) / 2]);
    return layer;
  }

  function addCircle(comp, item) {
    var layer = comp.layers.addShape();
    layer.name = item.id + " [" + item.role + "]";
    var contents = layer.property("ADBE Root Vectors Group");
    var group = contents.addProperty("ADBE Vector Group");
    var vectors = group.property("ADBE Vectors Group");
    var ellipse = vectors.addProperty("ADBE Vector Shape - Ellipse");
    ellipse.property("ADBE Vector Ellipse Size").setValue([(item.r || 1) * 2, (item.r || 1) * 2]);
    var fill = vectors.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue(hexToRgb(item.fill));
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([item.cx || 0, item.cy || 0]);
    return layer;
  }

  function addText(comp, item) {
    var layer = comp.layers.addText(item.text || "");
    layer.name = item.id + " [" + item.role + "]";
    var textDocument = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
    textDocument.fontSize = item.size || 32;
    textDocument.fillColor = hexToRgb(item.fill);
    textDocument.justification = ParagraphJustification.LEFT_JUSTIFY;
    layer.property("ADBE Text Properties").property("ADBE Text Document").setValue(textDocument);
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([item.x || 0, item.y || 0]);
    return layer;
  }

  app.beginUndoGroup("Create EdgeLab teaser asset comps");
  var project = app.project || app.newProject();
  var rootFolder = project.items.addFolder("EdgeLab AE Teaser Assets");

  for (var i = 0; i < scenes.length; i += 1) {
    var scene = scenes[i];
    var comp = project.items.addComp("EdgeLab - " + scene.title, WIDTH, HEIGHT, 1, DURATION, FPS);
    comp.parentFolder = rootFolder;
    for (var j = scene.layers.length - 1; j >= 0; j -= 1) {
      var item = scene.layers[j];
      var layer = null;
      if (item.type === "rect") layer = addRect(comp, item);
      if (item.type === "circle") layer = addCircle(comp, item);
      if (item.type === "text") layer = addText(comp, item);
      if (layer) {
        layer.inPoint = 0;
        layer.outPoint = DURATION;
        layer.label = 9;
      }
    }
    var marker = new MarkerValue("Timing placeholder: stagger panels, text, charts, and badges");
    comp.markerProperty.setValueAtTime(0.5, marker);
  }

  app.endUndoGroup();
}());
`;
}

function titleCase(value) {
  return String(value)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hexToRgb(hex) {
  const clean = String(hex).replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((char) => `${char}${char}`).join("")
    : clean;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
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
