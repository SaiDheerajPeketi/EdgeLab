import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  COLORS,
  DURATION_SECONDS,
  FPS,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  buildScenes,
  renderSceneSvg,
} from "../src/scene-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SVG_DIR = join(ROOT, "svg");
const PREVIEW_DIR = join(ROOT, "preview");
const AE_DIR = join(ROOT, "ae");
const HTML_DIR = join(ROOT, "html");

for (const dir of [SVG_DIR, PREVIEW_DIR, AE_DIR]) {
  mkdirSync(dir, { recursive: true });
}

cleanDir(SVG_DIR, ".svg");
cleanDir(PREVIEW_DIR, ".png");
rmSync(HTML_DIR, { recursive: true, force: true });

const scenes = buildScenes();

for (const scene of scenes) {
  const svgPath = join(SVG_DIR, `${scene.id}.svg`);
  const previewPath = join(PREVIEW_DIR, `${scene.id}.png`);
  writeFileSync(svgPath, renderSceneSvg(scene));
  rasterizePreview(svgPath, previewPath, scene);
}

writeFileSync(join(ROOT, "manifest.json"), `${JSON.stringify(buildManifest(scenes), null, 2)}\n`);
writeFileSync(join(AE_DIR, "edgelab-teaser-assets.jsx"), buildAeScript(scenes));

console.log(`Exported ${scenes.length} editable EdgeLab component lookalike scenes to ${ROOT}`);

function cleanDir(dir, extension) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (extname(file) === extension) {
      rmSync(join(dir, file), { force: true });
    }
  }
}

function buildManifest(scenes) {
  return {
    name: "EdgeLab AE Teaser Editable Components",
    version: "0.3.0",
    source: "AE-editable SVG primitives and native shape/text layer definitions based on EdgeLab app surfaces",
    dimensions: { width: SCENE_WIDTH, height: SCENE_HEIGHT, label: "4K UHD" },
    fps: FPS,
    duration_seconds: DURATION_SECONDS,
    excluded: [
      "Marketing hero / product overview",
      "Sign-in / beta access screens",
      "videos/edgelab-beta-launch",
      "HTML foreignObject captures",
    ],
    outputs: {
      svg: "svg/{component-scene-id}.svg",
      preview: "preview/{component-scene-id}.png",
      after_effects_script: "ae/edgelab-teaser-assets.jsx",
    },
    colors: COLORS,
    fonts: ["Inter", "Syne", "JetBrains Mono"],
    editing_notes: [
      "SVG files contain primitive rect, text, circle, line, and path elements only.",
      "The JSX creates native After Effects shape and text layers for the same logical layer list.",
      "Chart candles, tables, badges, metric cards, panels, and labels are separate logical layers where practical.",
    ],
    scenes: scenes.map((scene, index) => ({
      id: scene.id,
      title: scene.title,
      short_title: scene.shortTitle,
      width: scene.width,
      height: scene.height,
      import_order: index + 1,
      svg: `svg/${scene.id}.svg`,
      preview: `preview/${scene.id}.png`,
      layer_count: scene.layers.length,
      layer_roles: [...new Set(scene.layers.map((layer) => layer.role))].sort(),
      suggested_animation_handles: suggestHandles(scene),
    })),
  };
}

function suggestHandles(scene) {
  const handles = [
    { role: "panel", timing: "0:00-0:18", motion: "fade/scale panels on as grouped blocks" },
    { role: "panel-title", timing: "0:10-0:24", motion: "text reveal after parent panel" },
  ];
  if (scene.layers.some((layer) => layer.role?.includes("chart") || layer.role?.includes("candle"))) {
    handles.push({ role: "chart-line/candle-body", timing: "0:18-0:45", motion: "draw chart paths or cascade candle bodies left to right" });
  }
  if (scene.layers.some((layer) => layer.role?.includes("metric"))) {
    handles.push({ role: "metric-value", timing: "0:32-0:55", motion: "count values up with short opacity pop" });
  }
  if (scene.layers.some((layer) => layer.role?.includes("table"))) {
    handles.push({ role: "table-row", timing: "0:24-0:50", motion: "stagger rows by 2 frames" });
  }
  return handles;
}

function buildAeScript(scenes) {
  const sceneJson = JSON.stringify(scenes.map((scene) => ({
    id: scene.id,
    title: scene.title,
    shortTitle: scene.shortTitle,
    svg: `svg/${scene.id}.svg`,
    preview: `preview/${scene.id}.png`,
    layers: scene.layers,
  })), null, 2);

  return `/* EdgeLab AE Teaser Editable Components
 * Creates 4K comps with native After Effects shape/text layers.
 * No external plugins and no browser markup dependency.
 */
(function () {
  var WIDTH = ${SCENE_WIDTH};
  var HEIGHT = ${SCENE_HEIGHT};
  var FPS = ${FPS};
  var DURATION = ${DURATION_SECONDS};
  var scenes = ${sceneJson};
  var scriptFile = new File($.fileName);
  var rootFolderPath = scriptFile.parent.parent.fsName;

  app.beginUndoGroup("Build EdgeLab editable teaser components");
  var project = app.project || app.newProject();
  var rootFolder = project.items.addFolder("EdgeLab Editable Teaser Components");

  for (var i = 0; i < scenes.length; i += 1) {
    var scene = scenes[i];
    var comp = project.items.addComp("EdgeLab - " + scene.title, WIDTH, HEIGHT, 1, DURATION, FPS);
    comp.parentFolder = rootFolder;
    comp.markerProperty.setValueAtTime(0.5, new MarkerValue("Editable app lookalike: " + scene.title));

    for (var j = scene.layers.length - 1; j >= 0; j -= 1) {
      addLayer(comp, scene.layers[j]);
    }

    var svgFile = new File(rootFolderPath + "/" + scene.svg);
    if (svgFile.exists) {
      var svgItem = project.importFile(new ImportOptions(svgFile));
      svgItem.parentFolder = rootFolder;
      var svgLayer = comp.layers.add(svgItem);
      svgLayer.name = scene.id + " vector reference";
      svgLayer.enabled = false;
      svgLayer.outPoint = DURATION;
    }
  }

  app.endUndoGroup();

  function addLayer(comp, data) {
    if (data.type === "rect") return addRect(comp, data);
    if (data.type === "circle") return addCircle(comp, data);
    if (data.type === "line") return addLine(comp, data);
    if (data.type === "path") return addPath(comp, data);
    if (data.type === "text") return addText(comp, data);
  }

  function prepShape(layer, data) {
    layer.name = data.id + " [" + data.role + "]";
    layer.outPoint = DURATION;
    layer.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([0, 0]);
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
    if (data.opacity !== undefined) {
      layer.property("ADBE Transform Group").property("ADBE Opacity").setValue(data.opacity * 100);
    }
    return layer.property("ADBE Root Vectors Group");
  }

  function addRect(comp, data) {
    var layer = comp.layers.addShape();
    var contents = prepShape(layer, data);
    var group = contents.addProperty("ADBE Vector Group");
    var vectors = group.property("ADBE Vectors Group");
    var rect = vectors.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue([data.width, data.height]);
    rect.property("ADBE Vector Rect Position").setValue([data.x + data.width / 2, data.y + data.height / 2]);
    rect.property("ADBE Vector Rect Roundness").setValue(data.rx || 0);
    if (data.fill && data.fill !== "none") addFill(vectors, data.fill);
    if (data.stroke) addStroke(vectors, data.stroke, data.strokeWidth || 1);
  }

  function addCircle(comp, data) {
    var layer = comp.layers.addShape();
    var contents = prepShape(layer, data);
    var group = contents.addProperty("ADBE Vector Group");
    var vectors = group.property("ADBE Vectors Group");
    var ellipse = vectors.addProperty("ADBE Vector Shape - Ellipse");
    ellipse.property("ADBE Vector Ellipse Size").setValue([data.r * 2, data.r * 2]);
    ellipse.property("ADBE Vector Ellipse Position").setValue([data.cx, data.cy]);
    if (data.fill && data.fill !== "none") addFill(vectors, data.fill);
    if (data.stroke) addStroke(vectors, data.stroke, data.strokeWidth || 1);
  }

  function addLine(comp, data) {
    var layer = comp.layers.addShape();
    var contents = prepShape(layer, data);
    var group = contents.addProperty("ADBE Vector Group");
    var vectors = group.property("ADBE Vectors Group");
    var path = vectors.addProperty("ADBE Vector Shape - Group");
    var shape = new Shape();
    shape.vertices = [[data.x1, data.y1], [data.x2, data.y2]];
    shape.inTangents = [[0, 0], [0, 0]];
    shape.outTangents = [[0, 0], [0, 0]];
    shape.closed = false;
    path.property("ADBE Vector Shape").setValue(shape);
    addStroke(vectors, data.stroke || "#ffffff", data.strokeWidth || 1);
  }

  function addPath(comp, data) {
    var vertices = parseMoveLinePath(data.d);
    if (!vertices || vertices.length < 2) return;
    var layer = comp.layers.addShape();
    var contents = prepShape(layer, data);
    var group = contents.addProperty("ADBE Vector Group");
    var vectors = group.property("ADBE Vectors Group");
    var path = vectors.addProperty("ADBE Vector Shape - Group");
    var shape = new Shape();
    shape.vertices = vertices;
    shape.inTangents = zeroTangents(vertices);
    shape.outTangents = zeroTangents(vertices);
    shape.closed = false;
    path.property("ADBE Vector Shape").setValue(shape);
    if (data.stroke) addStroke(vectors, data.stroke, data.strokeWidth || 1);
    if (data.fill && data.fill !== "none") addFill(vectors, data.fill);
  }

  function addText(comp, data) {
    var layer = comp.layers.addText(data.text);
    layer.name = data.id + " [" + data.role + "]";
    layer.outPoint = DURATION;
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([data.x, data.y]);
    if (data.opacity !== undefined) {
      layer.property("ADBE Transform Group").property("ADBE Opacity").setValue(data.opacity * 100);
    }
    var doc = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
    doc.text = data.text;
    doc.fontSize = data.size || 32;
    doc.fillColor = hexToRgb(data.fill || "#ffffff");
    doc.applyFill = true;
    doc.applyStroke = false;
    doc.font = preferredFont(data.font);
    if (data.tracking !== undefined) doc.tracking = data.tracking * 10;
    layer.property("ADBE Text Properties").property("ADBE Text Document").setValue(doc);
  }

  function addFill(vectors, hex) {
    var fill = vectors.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue(hexToRgb(hex));
  }

  function addStroke(vectors, hex, width) {
    var stroke = vectors.addProperty("ADBE Vector Graphic - Stroke");
    stroke.property("ADBE Vector Stroke Color").setValue(hexToRgb(hex));
    stroke.property("ADBE Vector Stroke Width").setValue(width);
  }

  function hexToRgb(hex) {
    var clean = String(hex || "#ffffff").replace("#", "");
    if (clean.length === 3) {
      clean = clean.charAt(0) + clean.charAt(0) + clean.charAt(1) + clean.charAt(1) + clean.charAt(2) + clean.charAt(2);
    }
    return [
      parseInt(clean.substr(0, 2), 16) / 255,
      parseInt(clean.substr(2, 2), 16) / 255,
      parseInt(clean.substr(4, 2), 16) / 255,
    ];
  }

  function preferredFont(font) {
    if (!font) return "Inter";
    if (font.indexOf("JetBrains") >= 0) return "JetBrainsMono-Regular";
    if (font.indexOf("Syne") >= 0) return "Syne-Bold";
    return "Inter";
  }

  function parseMoveLinePath(d) {
    if (!d || d.indexOf("A") >= 0 || d.indexOf("C") >= 0 || d.indexOf("Q") >= 0) return null;
    var matches = d.match(/[ML]\\s*(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)/g);
    if (!matches) return null;
    var vertices = [];
    for (var i = 0; i < matches.length; i += 1) {
      var point = matches[i].match(/(-?\\d+(?:\\.\\d+)?)/g);
      vertices.push([parseFloat(point[0]), parseFloat(point[1])]);
    }
    return vertices;
  }

  function zeroTangents(vertices) {
    var tangents = [];
    for (var i = 0; i < vertices.length; i += 1) tangents.push([0, 0]);
    return tangents;
  }
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

function fallbackPng() {
  const pixels = Buffer.alloc(SCENE_WIDTH * SCENE_HEIGHT * 4);
  const bg = [5, 7, 10];
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = bg[0];
    pixels[index + 1] = bg[1];
    pixels[index + 2] = bg[2];
    pixels[index + 3] = 255;
  }
  return encodePng(SCENE_WIDTH, SCENE_HEIGHT, pixels);
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
