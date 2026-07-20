import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../../frontend/node_modules/vite/dist/node/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SVG_DIR = join(ROOT, "svg");
const PREVIEW_DIR = join(ROOT, "preview");
const AE_DIR = join(ROOT, "ae");
const HTML_DIR = join(ROOT, "html");
const CAPTURE_DIR = join(ROOT, ".capture-tmp");
const WIDTH = 3840;
const HEIGHT = 2160;
const FPS = 30;
const DURATION = 7;
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SCENES = [
  { id: "session-gateway", title: "Session gateway", sourceComponents: ["SessionGateway"] },
  { id: "replay-engine-workspace", title: "Replay engine workspace", sourceComponents: ["TradingChart", "ReplayController", "OrderTicket", "PositionPanel"] },
  { id: "trade-journal-notes", title: "Trade journal / notes", sourceComponents: ["JournalWorkspacePage"] },
  { id: "playbooks", title: "Playbooks", sourceComponents: ["PlaybookBoard"] },
  { id: "analytics-reports-dashboard", title: "Analytics / reports dashboard", sourceComponents: ["ResultsPanel"] },
  { id: "position-order-tools", title: "Position / order tools", sourceComponents: ["OrderTicket", "PositionPanel", "TradeLog"] },
  { id: "position-sizing-calculator", title: "Position sizing calculator", sourceComponents: ["PositionSizeCalculatorPage"] },
  { id: "economic-calendar", title: "Economic calendar", sourceComponents: ["EconomicCalendarPage"] },
];

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.socket.addEventListener("open", resolveReady, { once: true });
      this.socket.addEventListener("error", rejectReady, { once: true });
    });
    this.socket.addEventListener("message", async (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(await event.data.arrayBuffer()).toString("utf8"));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
  }

  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    const result = new Promise((resolveResult, rejectResult) => {
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult });
    });
    this.socket.send(JSON.stringify(payload));
    return result;
  }

  async close() {
    await this.ready.catch(() => {});
    this.socket.close();
  }
}

for (const dir of [SVG_DIR, PREVIEW_DIR, AE_DIR]) mkdirSync(dir, { recursive: true });
cleanDir(SVG_DIR, ".svg");
cleanDir(PREVIEW_DIR, ".png");
rmSync(HTML_DIR, { recursive: true, force: true });
rmSync(CAPTURE_DIR, { recursive: true, force: true });
mkdirSync(CAPTURE_DIR, { recursive: true });

const server = await createServer({
  root: ROOT,
  server: { host: "127.0.0.1", port: await freePort(), strictPort: true },
});

let chrome;
let client;
const capturedScenes = [];
let chromeLog = "";

try {
  await server.listen();
  const vitePort = server.httpServer.address().port;
  const chromePort = 0;
  chrome = launchChrome(chromePort);
  client = await connectToChrome(chromePort);
  const target = await createPage(client);

  for (const scene of SCENES) {
    const url = `http://127.0.0.1:${vitePort}/?capture=1&scene=${encodeURIComponent(scene.id)}`;
    await openScene(client, target.sessionId, url, scene.id);
    const screenshot = await screenshotScene(client, target.sessionId);
    writeFileSync(join(PREVIEW_DIR, `${scene.id}.png`), Buffer.from(screenshot, "base64"));

    const capture = await extractScene(client, target.sessionId, scene);
    const capturedScene = { ...scene, ...capture, preview: `preview/${scene.id}.png`, svg: `svg/${scene.id}.svg` };
    capturedScenes.push(capturedScene);
    writeFileSync(join(SVG_DIR, `${scene.id}.svg`), renderCaptureSvg(capturedScene));
  }

  writeFileSync(join(ROOT, "manifest.json"), `${JSON.stringify(buildManifest(capturedScenes), null, 2)}\n`);
  writeFileSync(join(AE_DIR, "edgelab-teaser-assets.jsx"), buildAeScript(capturedScenes));
  console.log(`Exported ${capturedScenes.length} actual EdgeLab component captures to ${ROOT}`);
} finally {
  await client?.close?.();
  chrome?.kill?.();
  await server.close();
}

function cleanDir(dir, extension) {
  for (const file of readdirSync(dir, { withFileTypes: true })) {
    if (file.isFile() && extname(file.name) === extension) rmSync(join(dir, file.name), { force: true });
  }
}

function launchChrome(port) {
  const child = spawn(CHROME_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(CAPTURE_DIR, "chrome-profile")}`,
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--window-size=3840,2160",
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => {
    chromeLog += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    chromeLog += chunk.toString();
  });
  return child;
}

async function connectToChrome(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (chrome?.exitCode !== null) {
      throw new Error(`Headless Chrome exited early with code ${chrome.exitCode}\n${chromeLog}`);
    }
    const wsMatch = chromeLog.match(/DevTools listening on (ws:\/\/\S+)/);
    if (wsMatch) {
      return new CdpClient(wsMatch[1]);
    }
    try {
      if (port > 0) {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        const data = await response.json();
        return new CdpClient(data.webSocketDebuggerUrl);
      }
    } catch {
      await delay(150);
    }
    await delay(150);
  }
  throw new Error(`Could not connect to headless Chrome\n${chromeLog}`);
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createNetServer();
    server.on("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function createPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: WIDTH,
    screenHeight: HEIGHT,
  }, sessionId);
  return { targetId, sessionId };
}

async function openScene(cdp, sessionId, url, sceneId) {
  await cdp.send("Page.navigate", { url }, sessionId);
  await waitFor(cdp, sessionId, `document.readyState === "complete" && !!document.querySelector('[data-actual-component-scene="${sceneId}"]')`);
  await cdp.send("Runtime.evaluate", { expression: "document.fonts && document.fonts.ready", awaitPromise: true }, sessionId);
  await delay(900);
}

async function waitFor(cdp, sessionId, expression) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
    if (result.result?.value) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function screenshotScene(cdp, sessionId) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  }, sessionId);
  return data;
}

async function extractScene(cdp, sessionId, scene) {
  const expression = `(${domExtractor.toString()})(${JSON.stringify(scene.id)})`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "DOM extraction failed");
  return result.result.value;
}

function domExtractor(sceneId) {
  const root = document.querySelector(`[data-actual-component-scene="${sceneId}"]`);
  if (!root) throw new Error(`Missing scene root ${sceneId}`);

  const rootRect = root.getBoundingClientRect();
  const layers = [];
  let counter = 0;

  function id(prefix) {
    counter += 1;
    return `${prefix}-${String(counter).padStart(4, "0")}`;
  }

  function toNum(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function rgbaParts(value) {
    if (!value || value === "transparent") return null;
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return value.startsWith("#") ? { color: value, alpha: 1 } : null;
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    const alpha = parts.length > 3 ? parts[3] : 1;
    if (alpha <= 0) return null;
    const color = `#${parts.slice(0, 3).map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0")).join("")}`;
    return { color, alpha };
  }

  function rectFor(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round((rect.left - rootRect.left) * 100) / 100,
      y: Math.round((rect.top - rootRect.top) * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    };
  }

  function visible(element, rect, style) {
    return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden" && Number.parseFloat(style.opacity || "1") > 0.01;
  }

  function roleFor(element) {
    const classes = typeof element.className === "string" ? element.className : "";
    const tag = element.tagName.toLowerCase();
    if (element.closest("button") || tag === "button") return "button";
    if (tag === "input" || tag === "select" || tag === "textarea") return "field";
    if (classes.includes("card") || classes.includes("panel") || classes.includes("rounded")) return "panel";
    if (tag.match(/^h[1-6]$/)) return "heading";
    if (tag === "svg") return "svg-fragment";
    if (tag === "canvas") return "canvas";
    return tag;
  }

  function addTextLayers(element) {
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const textRect = range.getBoundingClientRect();
      range.detach();
      if (textRect.width <= 1 || textRect.height <= 1) continue;
      const style = getComputedStyle(element);
      const fill = rgbaParts(style.color);
      if (!fill) continue;
      layers.push({
        id: id("text"),
        type: "text",
        role: roleFor(element),
        text,
        x: Math.round((textRect.left - rootRect.left) * 100) / 100,
        y: Math.round((textRect.top - rootRect.top + toNum(style.fontSize) * 0.86) * 100) / 100,
        width: Math.round(textRect.width * 100) / 100,
        height: Math.round(textRect.height * 100) / 100,
        fill: fill.color,
        opacity: fill.alpha * Number.parseFloat(style.opacity || "1"),
        fontSize: toNum(style.fontSize),
        fontWeight: style.fontWeight,
        fontFamily: style.fontFamily,
        letterSpacing: toNum(style.letterSpacing),
      });
    }
  }

  function addElementLayer(element) {
    if (element !== root && element.closest("svg")) return;
    const style = getComputedStyle(element);
    const rect = rectFor(element);
    if (!visible(element, rect, style)) return;

    if (element.tagName.toLowerCase() === "svg") {
      layers.push({
        id: id("svg"),
        type: "svg",
        role: "svg-fragment",
        ...rect,
        viewBox: element.getAttribute("viewBox") || `0 0 ${rect.width} ${rect.height}`,
        preserveAspectRatio: element.getAttribute("preserveAspectRatio") || "none",
        inner: element.innerHTML,
      });
      return;
    }

    if (element.tagName.toLowerCase() === "canvas") {
      layers.push({
        id: id("canvas"),
        type: "image",
        role: "canvas",
        ...rect,
        href: element.toDataURL("image/png"),
      });
      return;
    }

    const bg = rgbaParts(style.backgroundColor);
    const borderColor = rgbaParts(style.borderTopColor);
    const borderWidth = Math.max(toNum(style.borderTopWidth), toNum(style.borderRightWidth), toNum(style.borderBottomWidth), toNum(style.borderLeftWidth));
    if ((bg || borderWidth > 0) && rect.width > 2 && rect.height > 2) {
      layers.push({
        id: id("rect"),
        type: "rect",
        role: roleFor(element),
        ...rect,
        rx: Math.max(toNum(style.borderTopLeftRadius), toNum(style.borderTopRightRadius), toNum(style.borderBottomRightRadius), toNum(style.borderBottomLeftRadius)),
        fill: bg?.color || "none",
        opacity: (bg?.alpha ?? 1) * Number.parseFloat(style.opacity || "1"),
        stroke: borderWidth > 0 ? borderColor?.color : null,
        strokeWidth: borderWidth > 0 ? borderWidth : 0,
      });
    }

    addTextLayers(element);
  }

  const all = [root, ...root.querySelectorAll("*")];
  for (const element of all) addElementLayer(element);

  return {
    width: 3840,
    height: 2160,
    layerCount: layers.length,
    layers,
    extractedAt: new Date().toISOString(),
  };
}

function renderCaptureSvg(scene) {
  const body = scene.layers.map((layer) => renderSvgLayer(layer)).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="${scene.id}-title">
  <title id="${scene.id}-title">${esc(scene.title)}</title>
  <metadata>${esc(JSON.stringify({ id: scene.id, title: scene.title, source: "actual EdgeLab React component DOM capture", sourceComponents: scene.sourceComponents }))}</metadata>
  ${body}
</svg>
`;
}

function renderSvgLayer(layer) {
  const common = { id: layer.id, "data-role": layer.role, opacity: layer.opacity };
  if (layer.type === "rect") {
    return `<rect ${attrs({ ...common, x: layer.x, y: layer.y, width: layer.width, height: layer.height, rx: layer.rx, fill: layer.fill, stroke: layer.stroke, "stroke-width": layer.strokeWidth })} />`;
  }
  if (layer.type === "text") {
    return `<text ${attrs({ ...common, x: layer.x, y: layer.y, fill: layer.fill, "font-family": layer.fontFamily, "font-size": layer.fontSize, "font-weight": layer.fontWeight, "letter-spacing": layer.letterSpacing })}>${esc(layer.text)}</text>`;
  }
  if (layer.type === "svg") {
    return `<g ${attrs(common)} transform="translate(${layer.x} ${layer.y})"><svg ${attrs({ width: layer.width, height: layer.height, viewBox: layer.viewBox, preserveAspectRatio: layer.preserveAspectRatio })}>${layer.inner}</svg></g>`;
  }
  if (layer.type === "image") {
    return `<image ${attrs({ ...common, x: layer.x, y: layer.y, width: layer.width, height: layer.height, href: layer.href })} />`;
  }
  return "";
}

function buildManifest(scenes) {
  return {
    name: "EdgeLab AE Teaser Actual App Components",
    version: "0.4.0",
    source: "actual EdgeLab React components rendered in headless Chrome and extracted from computed DOM",
    dimensions: { width: WIDTH, height: HEIGHT, label: "4K UHD" },
    fps: FPS,
    duration_seconds: DURATION,
    excluded: ["Marketing hero / product overview", "Sign-in / beta access screens", "videos/edgelab-beta-launch"],
    outputs: {
      svg: "svg/{scene-id}.svg",
      preview: "preview/{scene-id}.png",
      after_effects_script: "ae/edgelab-teaser-assets.jsx",
    },
    capture: {
      method: "Vite render of actual frontend components plus headless Chrome DOM/CSS extraction",
      viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    },
    scenes: scenes.map((scene, index) => ({
      id: scene.id,
      title: scene.title,
      sourceComponents: scene.sourceComponents,
      width: scene.width,
      height: scene.height,
      import_order: index + 1,
      svg: scene.svg,
      preview: scene.preview,
      layer_count: scene.layerCount,
      native_ae_layer_count: scene.layers.filter((layer) => layer.type === "rect" || layer.type === "text").length,
      layer_types: countBy(scene.layers, "type"),
      layer_roles: [...new Set(scene.layers.map((layer) => layer.role))].sort(),
      suggested_animation_handles: [
        { layer_type: "rect", timing: "0:00-0:18", motion: "panel/card fade and slight scale" },
        { layer_type: "text", timing: "0:08-0:24", motion: "text opacity reveal or trim-by-line" },
        { layer_type: "svg", timing: "0:16-0:40", motion: "convert imported SVG to shapes in AE for chart/path reveals" },
      ],
    })),
  };
}

function buildAeScript(scenes) {
  const data = JSON.stringify(scenes.map((scene) => ({
    id: scene.id,
    title: scene.title,
    sourceComponents: scene.sourceComponents,
    svg: scene.svg,
    preview: scene.preview,
    layers: scene.layers.filter((layer) => layer.type === "rect" || layer.type === "text"),
  })), null, 2);

  return `/* EdgeLab AE Teaser Actual App Components
 * Builds comps from computed DOM layers extracted from the real React app.
 * The imported SVG is an exact vector reference; native rect/text layers are editable.
 */
(function () {
  var WIDTH = ${WIDTH};
  var HEIGHT = ${HEIGHT};
  var FPS = ${FPS};
  var DURATION = ${DURATION};
  var scenes = ${data};
  var scriptFile = new File($.fileName);
  var rootFolderPath = scriptFile.parent.parent.fsName;

  app.beginUndoGroup("Build EdgeLab actual app component assets");
  var project = app.project || app.newProject();
  var rootFolder = project.items.addFolder("EdgeLab Actual App Components");
  var exactFolder = project.items.addFolder("Exact SVG imports");
  exactFolder.parentFolder = rootFolder;
  var editableFolder = project.items.addFolder("Editable DOM layer comps");
  editableFolder.parentFolder = rootFolder;

  for (var i = 0; i < scenes.length; i += 1) {
    var scene = scenes[i];
    buildExactComp(project, exactFolder, rootFolderPath, scene);
    buildEditableComp(project, editableFolder, rootFolderPath, scene);
  }

  app.endUndoGroup();

  function buildExactComp(project, folder, rootFolderPath, scene) {
    var comp = project.items.addComp("EdgeLab Exact - " + scene.title, WIDTH, HEIGHT, 1, DURATION, FPS);
    comp.parentFolder = folder;
    var svgFile = new File(rootFolderPath + "/" + scene.svg);
    if (svgFile.exists) {
      var svgItem = project.importFile(new ImportOptions(svgFile));
      svgItem.parentFolder = folder;
      var layer = comp.layers.add(svgItem);
      layer.name = scene.id + " exact extracted SVG";
      layer.outPoint = DURATION;
    }
    comp.markerProperty.setValueAtTime(0.5, new MarkerValue("Actual app components: " + scene.sourceComponents.join(", ")));
  }

  function buildEditableComp(project, folder, rootFolderPath, scene) {
    var comp = project.items.addComp("EdgeLab Editable - " + scene.title, WIDTH, HEIGHT, 1, DURATION, FPS);
    comp.parentFolder = folder;

    var previewFile = new File(rootFolderPath + "/" + scene.preview);
    if (previewFile.exists) {
      var previewItem = project.importFile(new ImportOptions(previewFile));
      previewItem.parentFolder = folder;
      var previewLayer = comp.layers.add(previewItem);
      previewLayer.name = scene.id + " exact screenshot reference";
      previewLayer.outPoint = DURATION;
      previewLayer.enabled = false;
    }

    for (var j = scene.layers.length - 1; j >= 0; j -= 1) {
      addLayer(comp, scene.layers[j]);
    }

    comp.markerProperty.setValueAtTime(0.5, new MarkerValue("Editable computed DOM layers: " + scene.sourceComponents.join(", ")));
  }

  function addLayer(comp, data) {
    if (data.type === "rect") return addRect(comp, data);
    if (data.type === "text") return addText(comp, data);
  }

  function addRect(comp, data) {
    var layer = comp.layers.addShape();
    layer.name = data.id + " [" + data.role + "]";
    layer.outPoint = DURATION;
    var transform = layer.property("ADBE Transform Group");
    transform.property("ADBE Anchor Point").setValue([0, 0]);
    transform.property("ADBE Position").setValue([0, 0]);
    if (data.opacity !== undefined) transform.property("ADBE Opacity").setValue(Math.max(0, Math.min(100, data.opacity * 100)));
    var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    var vectors = group.property("ADBE Vectors Group");
    var rect = vectors.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue([data.width, data.height]);
    rect.property("ADBE Vector Rect Position").setValue([data.x + data.width / 2, data.y + data.height / 2]);
    rect.property("ADBE Vector Rect Roundness").setValue(data.rx || 0);
    if (data.fill && data.fill !== "none") addFill(vectors, data.fill);
    if (data.stroke && data.strokeWidth > 0) addStroke(vectors, data.stroke, data.strokeWidth);
  }

  function addText(comp, data) {
    var layer = comp.layers.addText(data.text);
    layer.name = data.id + " [" + data.role + "]";
    layer.outPoint = DURATION;
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([data.x, data.y]);
    if (data.opacity !== undefined) {
      layer.property("ADBE Transform Group").property("ADBE Opacity").setValue(Math.max(0, Math.min(100, data.opacity * 100)));
    }
    var doc = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
    doc.text = data.text;
    doc.fontSize = data.fontSize || 24;
    doc.fillColor = hexToRgb(data.fill || "#ffffff");
    doc.applyFill = true;
    doc.applyStroke = false;
    doc.font = preferredFont(data.fontFamily);
    if (data.letterSpacing !== undefined) doc.tracking = data.letterSpacing * 10;
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
    if (clean.length === 3) clean = clean.charAt(0) + clean.charAt(0) + clean.charAt(1) + clean.charAt(1) + clean.charAt(2) + clean.charAt(2);
    return [parseInt(clean.substr(0, 2), 16) / 255, parseInt(clean.substr(2, 2), 16) / 255, parseInt(clean.substr(4, 2), 16) / 255];
  }

  function preferredFont(fontFamily) {
    var family = String(fontFamily || "");
    if (family.indexOf("JetBrains") >= 0) return "JetBrainsMono-Regular";
    if (family.indexOf("Syne") >= 0) return "Syne-Bold";
    return "Inter";
  }
}());
`;
}

function countBy(items, key) {
  return items.reduce((result, item) => {
    result[item[key]] = (result[item[key]] || 0) + 1;
    return result;
  }, {});
}

function attrs(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}="${esc(value)}"`)
    .join(" ");
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
