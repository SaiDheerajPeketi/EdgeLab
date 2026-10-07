import { expect, test as base, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import axe from "axe-core";
import { betaSessionResponse, FROZEN_TIME, gotoStable } from "./support/app";
import { fulfillReplayContext, prepare } from "./support/replay-context";
import type { PineCatalogManifest } from "../frontend/src/lib/pineCatalog";
import type { CustomIndicatorScript } from "../frontend/src/lib/customIndicators";
import type { PineExecutionResult, PineResponse } from "../frontend/src/lib/pineProtocol";

const overlay = '//@version=5\nindicator("Native editor EMA", overlay=true)\nlength=input.int(3,"Length",minval=1,maxval=20)\nplot(ta.ema(close,length),"Native EMA",color=#ff00ff)';
const artifacts = path.resolve(".artifacts/pine-clarity38/browser");
type Receipt = { operation_id: string; method: string; path: string; status: "reserved" | "completed"; http_status: number | null; result: null; created_at: string; completed_at: string | null };

declare global {
  interface Window {
    __nativeEditorResults: PineResponse[];
    __nativeEditorHoldRun: boolean;
    __nativeEditorHoldPrepare: boolean;
    __nativeEditorHeldResult: MessageEvent | null;
  }
}

async function fixture(page: Page) {
  await prepare(page);
  await fulfillReplayContext(page);
  const storage = new Map<string, unknown>();
  const receipts = new Map<string, Receipt>();
  const writes: Array<{ key: string; value: unknown }> = [];
  const identity = { token: betaSessionResponse.token, owner: 7001 };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/session") {
      await route.fulfill({ json: { ...betaSessionResponse, token: identity.token, user: { ...betaSessionResponse.user, id: identity.owner } } });
      return;
    }
    const metadata = endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (metadata) {
      expect(request.headers().authorization).toBe(`Bearer ${identity.token}`);
      const [, id, action] = metadata;
      if (action === "reserve") receipts.set(id, { operation_id: id, ...request.postDataJSON(), status: "reserved", http_status: null, result: null, created_at: "2026-09-15T10:00:00Z", completed_at: null });
      expect(receipts.has(id)).toBe(true);
      await route.fulfill({ json: receipts.get(id) });
      return;
    }
    const bound = request.headers()["x-edgelab-operation-id"];
    if (bound) {
      expect(receipts.get(bound)).toMatchObject({ method: request.method(), path: endpoint, status: "reserved" });
      Object.assign(receipts.get(bound)!, { status: "completed", http_status: 200, completed_at: "2026-09-15T10:00:01Z" });
    }
    const key = endpoint.match(/^\/app-storage\/edgelab\/(.+)$/)?.[1];
    if (key) {
      const decoded = decodeURIComponent(key);
      if (request.method() === "PUT") { storage.set(decoded, request.postDataJSON().value); writes.push({ key: decoded, value: structuredClone(storage.get(decoded)) }); }
      await route.fulfill({ json: { namespace: "edgelab", key: decoded, value: storage.get(decoded) ?? null, updated_at: FROZEN_TIME } });
      return;
    }
    await route.fallback();
  });
  // Observe genuine opaque-frame results. No worker, engine or result is replaced.
  await page.addInitScript(() => {
    window.__nativeEditorResults = [];
    window.__nativeEditorHoldRun = false;
    window.__nativeEditorHoldPrepare = false;
    window.__nativeEditorHeldResult = null;
    addEventListener("message", (event) => {
      const actual = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find((frame) => frame.contentWindow === event.source && frame.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (actual && event.origin === "null" && event.data?.type === "result") {
        window.__nativeEditorResults.push(event.data.payload);
        if (event.data.payload?.status === "completed" && ((window.__nativeEditorHoldRun && event.data.payload.result?.kind === "run") || (window.__nativeEditorHoldPrepare && event.data.payload.result?.kind === "prepare"))) {
          window.__nativeEditorHeldResult = event;
          event.stopImmediatePropagation();
        }
      }
    }, true);
  });
  await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  return { storage, writes, identity };
}

async function openEditor(page: Page) {
  const trigger = page.getByRole("button", { name: "Editor", exact: true });
  if (!await trigger.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await trigger.click();
  const editor = page.getByRole("dialog", { name: "EdgeLab indicator editor" });
  await expect(editor).toBeVisible();
  return editor;
}

async function fillSource(editor: Locator, source: string) {
  await editor.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
}

async function check(editor: Locator) {
  await editor.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
}

async function run(editor: Locator) {
  await editor.getByRole("button", { name: "Run", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
  await expect(editor.locator("#edge-editor-diagnostics")).toContainText(/PineTS|Pine/);
}

async function nativeRun(page: Page, source: string) {
  await expect.poll(() => page.evaluate((expected) => window.__nativeEditorResults.filter((item) => item.status === "completed" && item.result.kind === "run" && item.result.source === expected).length, source)).toBeGreaterThan(0);
  return page.evaluate((expected) => {
    const found = [...window.__nativeEditorResults].reverse().find((item) => item.status === "completed" && item.result.kind === "run" && item.result.source === expected);
    return found?.status === "completed" ? found.result as PineExecutionResult : null;
  }, source).then((result) => { expect(result).not.toBeNull(); return result!; });
}


const catalog = JSON.parse(fs.readFileSync(path.resolve("frontend/src/lib/pineCatalogManifest.json"), "utf8")) as PineCatalogManifest;
const sourceRoot = path.resolve("frontend/public/catalog/pine/everget", catalog.upstreamCommit);
const original = (entry: typeof catalog.entries[number]) => fs.readFileSync(path.join(sourceRoot, entry.path), "utf8");
const provenance = (entry: typeof catalog.entries[number]) => ({ catalogId: entry.id, repository: catalog.repository, path: entry.path,
  upstreamCommit: catalog.upstreamCommit, upstreamBlobSha1: entry.upstreamBlobSha1, sourceSha256: entry.sourceSha256,
  originalPineVersion: entry.pineVersion, author: entry.author, license: entry.license, originUrl: entry.originUrl, lastFetchedAt: catalog.lastFetchedAt });
const scripts = (storage: Map<string, unknown>) => (storage.get("custom-indicator-scripts.v1") ?? []) as CustomIndicatorScript[];
function snapshots(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(snapshots);
  const record = value as Record<string, unknown>;
  if (record.kind === "custom" && typeof record.customScriptSource === "string") return [record];
  const found = Object.values(record).flatMap(snapshots);
  return [...new Map(found.map((item) => [item.id, item])).values()];
}
async function catalogBrowser(editor: Locator) {
  const details = editor.locator("details").filter({ hasText: "Community Pine catalog" });
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.locator("summary").click();
  return details;
}
async function certifyCatalog(page: Page, target: Locator) {
  if (!await page.evaluate(() => "axe" in window)) await page.addScriptTag({ content: axe.source });
  const violations = await target.evaluate(async (element) => (await window.axe.run(element, {
    resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
  })).violations.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`));
  expect(violations, "New catalog WCAG 2.2 AA violations").toEqual([]);
}

async function view(browser: Locator, entry: typeof catalog.entries[number]) {
  await browser.getByRole("combobox", { name: "Script", exact: true }).selectOption(entry.id);
  await browser.getByRole("button", { name: "View source", exact: true }).click();
  await expect(browser.getByLabel(`${entry.name} original source`, { exact: true })).toHaveText(original(entry));
}

import { build } from "esbuild";
import http from "node:http";
declare global { interface Window { pineVisualFixture: any; } }
const oracleBars = JSON.parse(fs.readFileSync(path.resolve("e2e/pine-visuals.bars.json"),"utf8"));
const fixtureSource = "import { createChart } from \"../frontend/node_modules/lightweight-charts\";\nimport { createPineRuntimeJob } from \"../frontend/src/lib/pineRuntime\";\nimport { adaptPineChartResult, installPineChartPlots } from \"../frontend/src/lib/pineChartAdapter\";\nimport { getPackedPinePlot } from \"../frontend/src/lib/pinePacked\";\nlet state;\nconst paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));\n// LWC v4 takeScreenshot excludes the top primitive canvas. Composite every actual chart canvas using its DOM placement so shape/text pixel proofs include that layer.\nconst image = (chart, element) => {\n  const canvas = document.createElement(\"canvas\"), rect = element.getBoundingClientRect();\n  canvas.width = rect.width;\n  canvas.height = rect.height;\n  const ctx = canvas.getContext(\"2d\");\n  for (const layer of element.querySelectorAll(\"canvas\")) {\n    const bounds = layer.getBoundingClientRect();\n    ctx.drawImage(layer, bounds.left - rect.left, bounds.top - rect.top, bounds.width, bounds.height);\n  }\n  return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };\n};\nexport async function run(source, bars, options = {}) {\n  if (state)\n    for (const p of state.placements) {\n      p.installed?.dispose();\n      p.chart.remove();\n    }\n  const main = document.querySelector(\"#main\"), pane = document.querySelector(\"#pane\");\n  main.replaceChildren();\n  pane.replaceChildren();\n  pane.hidden = true;\n  const result = await createPineRuntimeJob({ action: \"run\", source, bars, context: { symbol: \"TEST\", timeframe: \"1\", mintick: .01, pointvalue: 1 }, mode: \"historical\" }).promise;\n  const adapted = adaptPineChartResult(result, bars), bounds = options.bounds ?? [80, 120], from = options.from ?? Math.max(0, bars.length - 30), to = options.to ?? bars.length - 1;\n  function make(element, candles) {\n    element.hidden = false;\n    const chart = createChart(element, { width: element.clientWidth, height: 128, layout: { background: { color: \"#111827\" }, textColor: \"#cbd5e1\" }, grid: { vertLines: { visible: false }, horzLines: { visible: false } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true, visible:false }, crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } });\n    const fixed = () => ({ priceRange: { minValue: bounds[0], maxValue: bounds[1] } });\n    const base = candles ? chart.addCandlestickSeries({ upColor: \"#475569\", downColor: \"#475569\", wickUpColor: \"#475569\", wickDownColor: \"#475569\", borderVisible: false, autoscaleInfoProvider: fixed })\n      : chart.addLineSeries({ color: \"transparent\", lineVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: fixed });\n    const chartBars = candles ? options.chartBars ?? bars : bars;\n    base.setData(candles ? chartBars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })) : chartBars.map(b => ({ time: b.time, value: bounds[0] })));\n    chart.timeScale().setVisibleLogicalRange({ from, to });\n    return { chart, base, element, before: null, installed: null };\n  }\n  const placements = [make(main, true)];\n  if (adapted.plots.some(p => !p.overlay))\n    placements.push(make(pane, false));\n  await paint();\n  for (const p of placements) {\n    p.before = image(p.chart, p.element);\n    p.beforeCoordinate = p.base.priceToCoordinate(100);\n  }\n  placements[0].installed = installPineChartPlots(placements[0].chart, adapted.plots.filter(p => p.overlay), \"right\", { allowFillOnlyScale: false, scaleAnchor: (options.chartBars ?? bars).at(-1) });\n  if (placements[1])\n    placements[1].installed = installPineChartPlots(placements[1].chart, adapted.plots.filter(p => !p.overlay));\n  state = { result, adapted, bars, placements };\n  document.querySelector(\"#status\").textContent = result.name + \" \u00b7 \" + result.audit.engine + \" \" + result.audit.engineVersion + \" \u00b7 \" + result.plots.length + \" outputs \u00b7 \" + bars.length + \" bars\";\n  await paint();\n  return summary();\n}\nexport function summary() { return { outputs: state.result.plots.length, plots: state.result.plots.map(p => ({ id: p.id, name: p.name, style: p.style, options: p.options })), drawn: state.adapted.plots.map(p => p.name), warnings: state.adapted.warnings, packed: state.result.plots.map(p => Boolean(getPackedPinePlot(p))), placements: state.placements.map(p => ({ beforeCoordinate: p.beforeCoordinate, primaryCoordinate: p.base.priceToCoordinate(100), visible: p.chart.timeScale().getVisibleLogicalRange(), series: p.installed.series.length, finiteHostCoordinate: p.installed.series.length ? Number.isFinite(p.installed.series[0].priceToCoordinate(100)) : true, range: p.installed.primitive?.rangeForVisible(), stats: p.installed.primitive?.debugStats })) }; }\nexport function probe(time, price, { placement = 0, radius = 2, dx = 0, dy = 0 } = {}) {\n  const p = state.placements[placement], after = image(p.chart, p.element), before = p.before, x = p.chart.timeScale().timeToCoordinate(time), y = (p.disposed ? p.base : p.installed.series[0] ?? p.base)?.priceToCoordinate(price);\n  if (x === null || y === null || !Number.isFinite(x + y))\n    return { x, y, changed: 0, red: 0, green: 0, blue: 0, white: 0 };\n  let changed = 0, red = 0, green = 0, blue = 0, white = 0;\n  const cx = Math.round(x + dx), cy = Math.round(y + dy);\n  for (let yy = cy - radius; yy <= cy + radius; yy++)\n    for (let xx = cx - radius; xx <= cx + radius; xx++) {\n      if (xx < 0 || yy < 0 || xx >= after.width || yy >= after.height)\n        continue;\n      const o = (yy * after.width + xx) * 4, [r, g, b] = after.pixels.slice(o, o + 3);\n      if ([0, 1, 2].some(l => Math.abs(after.pixels[o + l] - before.pixels[o + l]) > 8))\n        changed++;\n      if (r > 100 && r > g * 1.3 && r > b * 1.3)\n        red++;\n      if (g > 100 && g > r * 1.3 && g > b * 1.2)\n        green++;\n      if (b > 100 && b > r * 1.3)\n        blue++;\n      if (r > 210 && g > 210 && b > 210)\n        white++;\n    }\n  const offset = (cy * after.width + cx) * 4;\n  const samplePrice = (p.disposed ? p.base : p.installed.series[0] ?? p.base).coordinateToPrice(cy + .5);\n  return { x, y, samplePrice, changed, red, green, blue, white, pixel: Array.from(after.pixels.slice(offset, offset + 3)) };\n}\nexport async function pan(from, to) {\n  for (const p of state.placements)\n    p.chart.timeScale().setVisibleLogicalRange({ from, to });\n  await paint();\n  return summary();\n}\nexport async function resize() {\n  for (const p of state.placements)\n    p.chart.resize(p.element.clientWidth, 128);\n  await paint();\n  return summary();\n}\nexport async function dispose() {\n  for (const p of state.placements) {\n    p.installed.dispose();\n    p.installed.dispose();\n    p.disposed = true;\n  }\n  await paint();\n  return state.placements.map(p => ({ stats: p.installed.primitive?.debugStats }));\n}\nexport function intervalProbe(leftTime, rightTime, price, options = {}) { const scale = state.placements[options.placement ?? 0].chart.timeScale(); return probe(rightTime, price, { ...options, dx: (scale.timeToCoordinate(leftTime) - scale.timeToCoordinate(rightTime)) * (1 - (options.fraction ?? .5)), radius: 1 }); }\n\n// Inspect the actual primitive canvas across the plot area, including whitespace beyond loaded bars.\nexport function levelProbe(price, { placement = 0, channel = \"red\" } = {}) {\n  const p = state.placements[placement], after = image(p.chart, p.element);\n  const y = (p.disposed ? p.base : p.installed.series[0] ?? p.base).priceToCoordinate(price);\n  const width = Math.floor(p.chart.paneSize().width), cy = Math.round(y);\n  if (y === null || !Number.isFinite(y)) return { y, width, painted: 0, samples: width - 8, runs: 0 };\n  const lane = { red: 0, green: 1, blue: 2 }[channel];\n  let painted = 0, runs = 0, prior = false;\n  for (let x = 4; x < width - 4; x++) {\n    let hit = false;\n    for (let yy = Math.max(0, cy - 3); yy <= Math.min(after.height - 1, cy + 3); yy++) {\n      const offset = (yy * after.width + x) * 4;\n      const rgb = [...after.pixels.slice(offset, offset + 3)];\n      if (rgb[lane] > 120 && rgb[lane] > rgb[(lane + 1) % 3] * 1.5 && rgb[lane] > rgb[(lane + 2) % 3] * 1.5) hit = true;\n    }\n    if (hit) painted++;\n    if (hit && !prior) runs++;\n    prior = hit;\n  }\n  return { y, width, painted, samples: width - 8, runs };\n}\n\nexport async function invert(value) { for(const p of state.placements) p.chart.applyOptions({rightPriceScale:{invertScale:value}}); await paint(); return summary(); }\n";
type Harness = {
  origin: string;
  workerRequests: string[];
  otherRequests: string[];
};
const test = base.extend<{
  harness: Harness;
}, {
  serverHarness: Harness;
}>({
  serverHarness: [async ({}, use) => {
      expect(createHash("sha256").update(fs.readFileSync(path.resolve("e2e/pine-visuals.bars.json"))).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
      const root = path.resolve(import.meta.dirname, "..");
      const bytes = fs.readFileSync(path.join(root,"e2e/pine-visuals.bars.json"));
      const assets = path.join(root, "frontend/dist/assets"), workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
      if (!workerName)
        throw new Error("Root must freeze/build production before this suite.");
      const workerPath = "/assets/" + workerName;
      const bundled = await build({ stdin: {contents: fixtureSource, resolveDir: path.join(root,"e2e"),loader:"ts",sourcefile:"clarity-glyph-fixture.ts"}, bundle: true, write: false, platform: "browser", format: "iife", globalName: "pineVisualFixture",
        plugins: [{ name: "frozen-native-worker", setup(builder) {
              builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "production-worker", namespace: "pine-visual-fixture" }));
              builder.onLoad({ filter: /.*/, namespace: "pine-visual-fixture" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
            } }] });
      const worker = fs.readFileSync(path.join(assets, workerName)), workerRequests: string[] = [], otherRequests: string[] = [];
      const server = http.createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
        response.setHeader("Cache-Control", "no-store");
        if (pathname === "/") {
          response.setHeader("Content-Type", "text/html");
          response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pine visual proof</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}h1{font-size:20px;margin:0 0 8px}p{color:#94a3b8;margin:0 0 18px}.chart{width:100%;margin-bottom:20px}</style><h1>Original Pine output · actual chart canvas</h1><p id="status" role="status">Awaiting genuine production engine</p><div id="main" class="chart"></div><div id="pane" class="chart" hidden></div><script src="/fixture.js"></script>');
        }
        else if (pathname === "/fixture.js") {
          response.setHeader("Content-Type", "text/javascript");
          response.end(bundled.outputFiles[0].contents);
        }
        else if (pathname === workerPath) {
          workerRequests.push(pathname);
          response.setHeader("Content-Type", "text/javascript");
          response.end(worker);
        }
        else if (pathname === "/favicon.ico") {
          response.statusCode = 204;
          response.end();
        }
        else {
          otherRequests.push(pathname);
          response.statusCode = 404;
          response.end();
        }
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Fixture server not bound");
      try {
        await use({ origin: "http://127.0.0.1:" + address.port, workerRequests, otherRequests });
      }
      finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => { serverHarness.workerRequests.length = 0; serverHarness.otherRequests.length = 0; await page.goto(serverHarness.origin); await use(serverHarness); }
});

const migrationPins = JSON.parse(fs.readFileSync(path.resolve("frontend/src/lib/pineCatalogMigrations.json"), "utf8")).entries as Array<{ catalogId: string; sourcePath: string }>;
const migrated = (entry: typeof catalog.entries[number]) => fs.readFileSync(path.resolve("frontend/public", "." + migrationPins.find((pin) => pin.catalogId === entry.id)!.sourcePath), "utf8");
const selectedPaths = ["hull_moving_average", "simple_moving_average", "exponential_moving_average", "weighted_moving_average", "double_exponential_moving_average", "t3_moving_average", "stochastic"];
async function captureClarity(page: Page, name: string, project: string) { fs.mkdirSync(artifacts, { recursive: true }); await page.screenshot({ path: path.join(artifacts, name + "-" + project + ".png") }); }
test("six migrated moving studies and Stochastic keep one attributable keyboard disclosure and a readable128px pane", async ({ page }, info) => {
  test.setTimeout(120000);
  await fixture(page);
  const names: string[] = [];
  for (const stem of selectedPaths) {
    const entry = catalog.entries.find((item) => item.path.endsWith("/" + stem + ".pine"))!;
    const editor = await openEditor(page), browser = await catalogBrowser(editor);
    await view(browser, entry);
    await browser.getByRole("button", { name: "Import migrated draft", exact: true }).click();
    await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(migrated(entry));
    await check(editor); await run(editor);
    const actual = await nativeRun(page, migrated(entry)); names.push(actual.name);
    expect(actual.audit).toMatchObject({ engine: "PineTS", engineVersion: "0.11.0" });
    await editor.getByRole("button", { name: "Add to chart", exact: true }).click();
    await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  }
  const notice = page.getByLabel("Pine execution assumptions", { exact: true });
  await expect(notice).toHaveCount(1);
  const summary = notice.locator("summary"), body = notice.getByLabel("Assumption details and affected scripts", { exact: true });
  await expect(summary).toHaveText("Closed historical snapshot · 3 assumptions · 7 scripts");
  await expect(notice).not.toHaveAttribute("open", "");
  const box = await summary.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
  await summary.focus(); await page.keyboard.press("Enter"); await expect(notice).toHaveAttribute("open", "");
  await page.keyboard.press("Tab"); await expect(body).toBeFocused();
  for (const name of names) await expect(body).toContainText(name);
  for (const code of ["CLOSED_BAR_SNAPSHOT", "SNAPSHOT_CONTEXT", "DEFAULT_SYMBOL_METADATA"]) expect((await body.textContent())!.split(code).length - 1).toBe(1);
  const scrollable = await body.evaluate((node) => node.scrollHeight > node.clientHeight);
  await page.keyboard.press("End");
  if (scrollable) await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  else expect(await body.evaluate((node) => node.scrollTop)).toBe(0);
  await summary.focus(); await page.keyboard.press("Enter"); await expect(notice).not.toHaveAttribute("open", "");
  const stochWarning = page.getByRole("status").filter({ has: page.locator("strong").filter({ hasText: "Stochastic:" }) });
  await expect(stochWarning).not.toContainText(/background.*not rendered|unsupported.*background/i);
  await expect(stochWarning).toContainText(/local pixel metrics/i);
  await expect(stochWarning).not.toContainText("CLOSED_BAR_SNAPSHOT");
  await certifyCatalog(page, notice);
  const pane = page.getByRole("region", { name: "Stochastic native Pine pane", exact: true });
  await expect(pane).toBeVisible(); await pane.scrollIntoViewIfNeeded();
  const spread = await pane.locator("canvas").evaluateAll((nodes) => {
    let lo = Infinity, hi = -Infinity;
    for (const node of nodes) {
      const canvas = node as HTMLCanvasElement, rect = canvas.getBoundingClientRect(), data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width * .75; x++) {
        const i = (y * canvas.width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
        if (Math.max(r,g,b) > 120 && Math.max(r,g,b) - Math.min(r,g,b) > 70) { lo = Math.min(lo, y * rect.height / canvas.height); hi = Math.max(hi, y * rect.height / canvas.height); }
      }
    }
    return hi - lo;
  });
  expect(spread, "Actual Stochastic colored paths need useful height rather than a narrow band from empty label margins").toBeGreaterThanOrEqual(40);
  const plot = pane.locator("canvas").first(); expect((await plot.boundingBox())!.height).toBe(128);
  await captureClarity(page, "stochastic-pane", info.project.name);
  await summary.scrollIntoViewIfNeeded(); await captureClarity(page, "shared-assumptions-closed", info.project.name);
  await summary.focus(); await page.keyboard.press("Enter"); await body.scrollIntoViewIfNeeded();
  await captureClarity(page, "shared-assumptions-open", info.project.name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  // Use real pointer/touch actions: a hidden study's controls must not block the next study.
  // Defer the size gate until the flow completes so an intercepted second tap is reproducible.
  const touch = !!(info.project.use.hasTouch || info.project.use.isMobile);
  const targets: Array<{ name: string; width: number; height: number }> = [];
  const touchArtifacts = path.resolve(".artifacts/pine-study-touch40/browser");
  fs.mkdirSync(touchArtifacts, { recursive: true });
  const captureTouch = (name: string) => page.screenshot({ path: path.join(touchArtifacts, name + "-" + info.project.name + ".png") });
  const activate = async (control: Locator, name: string) => {
    await control.scrollIntoViewIfNeeded();
    const bounds = await control.boundingBox();
    expect(bounds, name + " has real screen bounds").not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(bounds!.x, name + " left edge").toBeGreaterThanOrEqual(0);
    expect(bounds!.y, name + " top edge").toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width, name + " right edge").toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds!.y + bounds!.height, name + " bottom edge").toBeLessThanOrEqual(viewport.height + 1);
    targets.push({ name, width: bounds!.width, height: bounds!.height });
    if (touch) await control.tap(); else await control.click();
  };
  await summary.focus(); await page.keyboard.press("Enter");
  await activate(page.locator(".chart-study-pill").filter({ hasText: names[0] }).first(), "Hull study");
  const settings = page.getByRole("group", { name: "Indicator settings", exact: true });
  await expect(settings).toContainText(names[0]);
  await activate(settings.getByTitle("Hide indicator", { exact: true }), "Hide Hull");
  await expect(summary).toHaveText("Closed historical snapshot · 3 assumptions · 6 scripts");
  await captureTouch("after-hide");
  const hideGeometry = await page.locator(".chart-stage").first().evaluate((stage) => {
    const bounds = (node: Element) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const ancestors = [];
    for (let node: HTMLElement | null = stage as HTMLElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      ancestors.push({ tag: node.tagName, className: node.className, bounds: bounds(node), scrollLeft: node.scrollLeft,
        clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, overflowX: style.overflowX, overflowY: style.overflowY });
    }
    const header = stage.querySelector(".chart-stage-header");
    return { viewportWidth: innerWidth, stage: bounds(stage), header: header ? bounds(header) : null, ancestors };
  });
  fs.writeFileSync(path.join(touchArtifacts, "after-hide-geometry-" + info.project.name + ".json"), JSON.stringify(hideGeometry, null, 2));
  if (info.project.use.isMobile) {
    expect(hideGeometry.stage.left, "Chart stays inside the mobile viewport after Hide").toBeGreaterThanOrEqual(0);
    expect(hideGeometry.stage.right, "Chart right edge after Hide").toBeLessThanOrEqual(hideGeometry.viewportWidth + 1);
    for (const ancestor of hideGeometry.ancestors) expect(ancestor.scrollLeft, ancestor.tag + "." + ancestor.className + " after Hide scrollLeft").toBe(0);
  }
  await expect(settings).toBeHidden();
  await summary.focus(); await page.keyboard.press("Enter"); await expect(body).not.toContainText(names[0]); await page.keyboard.press("Enter");
  await activate(page.locator(".chart-study-pill").filter({ hasText: names[5] }).first(), "T3 study after hiding Hull");
  await expect(settings).toContainText(names[5]);
  await expect(settings).not.toContainText(names[0]);
  const length = settings.getByRole("spinbutton", { name: "Length", exact: true });
  await expect(length).toHaveValue("5");
  await activate(length, "T3 Length");
  await length.fill("8");
  await expect(length).toHaveValue("8");
  const t3Source = migrated(catalog.entries.find((entry) => entry.path.endsWith("/t3_moving_average.pine"))!);
  await expect.poll(() => page.evaluate((source) => window.__nativeEditorResults.some((item) =>
    item.status === "completed" && item.result.kind === "run" && item.result.source === source
      && item.result.inputs.in_0 === 8 && item.result.audit.engineVersion === "0.11.0"), t3Source)).toBe(true);
  await expect(summary).toHaveText("Closed historical snapshot · 3 assumptions · 6 scripts");
  await captureTouch("edited-t3");
  const t3Trigger = page.locator(".chart-study-pill").filter({ hasText: names[5] }).first();
  await activate(settings.getByRole("button", { name: "Close indicator settings", exact: true }), "Close T3 settings");
  await expect(settings).toBeHidden();
  await expect(t3Trigger).toBeFocused();
  await activate(t3Trigger, "Reopen T3 after Close");
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("spinbutton", { name: "Length", exact: true })).toHaveValue("8");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(t3Trigger).toBeFocused();
  await activate(t3Trigger, "Reopen T3 after Escape");
  await expect(settings).toBeVisible();
  await activate(settings.getByTitle("Remove indicator", { exact: true }), "Remove T3");
  await expect(settings).toBeHidden();
  await expect(page.locator(".chart-study-pill").filter({ hasText: names[5] })).toHaveCount(0);
  await expect(summary).toHaveText("Closed historical snapshot · 3 assumptions · 5 scripts");
  await captureTouch("after-remove");
  if (touch) for (const target of targets) {
    expect(target.width, target.name + " touch width").toBeGreaterThanOrEqual(44);
    expect(target.height, target.name + " touch height").toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await summary.focus(); await page.keyboard.press("Enter"); await expect(body).not.toContainText(names[5]);
});
async function oracleRun(page: Page, source: string, snapshot = oracleBars) {
  const result = await page.evaluate(async (input) => window.pineVisualFixture.run(input.source, input.snapshot, input.options), { source, snapshot, options: { bounds: [0,100], from: 120, to: 152 } });
  expect(await page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0); return result;
}
const oracleProgram = (body: string) => '//@version=6\nindicator("Marker pixel proof",overlay=false)\n' + body;
test("genuine worker and actual128px LWC pane preserve every shape glyph and asymmetric inverted margins", async ({ page, harness }, info) => {
  test.setTimeout(120000);
  const shapeNames = ["circle","square","triangleup","triangledown","arrowup","arrowdown","labelup","labeldown"];
  for (const shape of shapeNames) for (const location of ["absolute","abovebar","belowbar"]) {
    const value = location === "absolute" ? "bar_index==128?100:na" : "bar_index==128";
    const source = oracleProgram('plotshape(' + value + ',"Marker",style=shape.' + shape + ',location=location.' + location + ',size=size.tiny,color=#ff0000,text="A",textcolor=#ffffff)');
    const result = await oracleRun(page, source);
    expect(result.outputs).toBe(1); expect(result.placements[1].finiteHostCoordinate).toBe(true);
    const price = location === "abovebar" ? oracleBars[128].high : location === "belowbar" ? oracleBars[128].low : 100;
    const pixels = await page.evaluate((input) => window.pineVisualFixture.probe(input.time,input.price,{ placement:1,radius:45 }), { time: oracleBars[128].time,price });
    expect(pixels.red, shape + "/" + location + " actual body pixels").toBeGreaterThan(0);
    expect(pixels.white, shape + "/" + location + " actual glyph pixels").toBeGreaterThan(0);
    if (shape === "labelup" || shape === "labeldown") {
      const normal = result.placements[1].range.margins;
      const inverted = await page.evaluate(() => window.pineVisualFixture.invert(true));
      expect(inverted.placements[1].range.margins).toEqual(normal);
      const after = await page.evaluate((input) => window.pineVisualFixture.probe(input.time,input.price,{ placement:1,radius:45 }), { time: oracleBars[128].time,price });
      expect(after.red, shape+"/"+location+" inverted body").toBeGreaterThan(0); expect(after.white,shape+"/"+location+" inverted glyph").toBeGreaterThan(0);
      if(shape === "labelup" && location === "belowbar") await captureClarity(page,"inverted-label-glyph",info.project.name);
    }
  }
  const source = oracleProgram('plotshape(bar_index==128?100:na,"Visible text",style=shape.labeldown,location=location.absolute,size=size.tiny,color=#ff000000,text="' + "\\n".repeat(32) + 'LAST",textcolor=#ffffff)');
  await oracleRun(page, source);
  const glyph = await page.evaluate((time) => window.pineVisualFixture.probe(time,100,{ placement:1,radius:30 }), oracleBars[128].time);
  expect(glyph.white, "33rdline remains visible; empty rows reserve spacing without fake glyphs").toBeGreaterThan(0);
  expect(glyph.red).toBe(0);
  await captureClarity(page, "glyph-33rd-line", info.project.name);
  expect(harness.workerRequests.length).toBeGreaterThan(20); expect(harness.otherRequests).toEqual([]);
});
test("20k packed visible markers decode lazily and survive pan resize invert and grouped disposal", async ({ page, harness }, info) => {
  const snapshot = Array.from({ length:20000 }, (_,index) => ({...oracleBars[0],time:oracleBars[0].time+index*60}));
  const source = oracleProgram('plotshape(bar_index%2==0?100:na,"Upper text",style=shape.labeldown,location=location.absolute,size=size.tiny,color=#00000000,text="UP",textcolor=#ffffff)\nplotshape(bar_index%2==1?0:na,"Lower text",style=shape.labelup,location=location.absolute,size=size.tiny,color=#00000000,text="DOWN",textcolor=#ffffff)');
  const first = await oracleRun(page,source,snapshot); expect(first.packed).toEqual([true,true]);
  expect(first.placements[1].stats.decodedSamples).toBeLessThan(400);
  const panned = await page.evaluate(() => window.pineVisualFixture.pan(15000,15024));
  expect(panned.placements[1].stats.decodedSamples-first.placements[1].stats.decodedSamples).toBeLessThan(400);
  const probe = await page.evaluate((time) => window.pineVisualFixture.probe(time,100,{placement:1,radius:25}), snapshot[15000].time); expect(probe.white).toBeGreaterThan(0);
  await page.evaluate(() => window.pineVisualFixture.resize()); await page.evaluate(() => window.pineVisualFixture.invert(true));
  const inverted = await page.evaluate((time) => window.pineVisualFixture.probe(time,100,{placement:1,radius:25}), snapshot[15000].time); expect(inverted.white).toBeGreaterThan(0);
  await captureClarity(page,"packed20k-markers",info.project.name);
  const disposed = await page.evaluate(() => window.pineVisualFixture.dispose());
  expect(disposed[1].stats.cacheEntries).toBe(0);
  const empty = await page.evaluate((time) => window.pineVisualFixture.probe(time,100,{placement:1,radius:25}),snapshot[15000].time); expect(empty.white).toBe(0);
  expect(harness.workerRequests).toHaveLength(1); expect(harness.otherRequests).toEqual([]);
});
