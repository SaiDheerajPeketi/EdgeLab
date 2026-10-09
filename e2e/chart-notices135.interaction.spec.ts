import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { build } from "esbuild";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { productSetup, editor } from "./pine-layering.product-support";

const root = path.resolve(import.meta.dirname, ".."), dist = path.join(root, "frontend/dist");
const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
function inventory(directory = dist): { file: string; sha256: string }[] {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const full = path.join(directory, name);
    return fs.statSync(full).isDirectory() ? inventory(full) : [{ file: path.relative(dist, full), sha256: hash(fs.readFileSync(full)) }];
  });
}
const polylineWarning = "Polylines use local uniform Catmull–Rom curves with possible overshoot, nonzero-winding fills and a layer above boxes/below labels. NA points break strokes and suppress fill/closed seams; unrepresentable curve controls omit the affected run. Exact TradingView spline, fill and layer calibration has not been verified.";
let server: http.Server, sealed: ReturnType<typeof inventory>;
test.beforeAll(async () => {
  sealed = inventory();
  const css = fs.readFileSync(path.join(dist, "index.html"), "utf8").match(/href="([^"]+\.css)"/)![1];
  const fixture = await build({ stdin: { resolveDir: root, sourcefile: "notices135-component-only.tsx", loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {PineChartNotices} from './frontend/src/components/PineChartNotices';
    const closed={code:'CLOSED_BAR_SNAPSHOT',message:'Supplied candles are treated as completed historical bars.',severity:'warning',line:1,column:1};
    const live={code:'REALTIME_CONTEXT',message:'Updates use the supplied live chart feed.',severity:'warning',line:1,column:1};
    const study=(id,name,diagnostics,adapterWarnings=[])=>({id,name,diagnostics,adapterWarnings});
    const cases={
      closed:[study('closed','Completed study',[closed])], live:[study('live','Live study',[live])],
      mixed:[study('closed','Completed study',[closed]),study('live','Live study',[live]),
        study('failure','Failed study',[{code:'CALCULATION_FAILED',message:'This study cannot calculate its result.',severity:'error',line:2,column:1},
          {code:'RENDERING_NOTE',message:'A chart drawing uses local geometry.',severity:'warning',line:3,column:1}], [${JSON.stringify(polylineWarning)}])]
    };
    const root=createRoot(document.getElementById('root'));
    window.notices135={show:(name,include='all')=>root.render(<main key={name+include} aria-label="Component diagnostic fixture"><p>Component-only diagnostic fixture. No Pine execution.</p><PineChartNotices studies={cases[name]} include={include}/></main>)};
    window.notices135.show('mixed');
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1").pathname; response.setHeader("Cache-Control", "no-store");
    if (url === "/") { response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${css}"><style>body{margin:12px}</style><div id="root"></div><script src="/fixture.js"></script>`); return; }
    if (url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(fixture.outputFiles[0].contents); return; }
    const full = path.resolve(dist, "." + url);
    if (full.startsWith(dist + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile()) { response.setHeader("Content-Type", url.endsWith(".css") ? "text/css" : url.endsWith(".woff2") ? "font/woff2" : "application/octet-stream"); response.end(fs.readFileSync(full)); return; }
    response.statusCode = url === "/favicon.ico" ? 204 : 404; response.end();
  });
  await new Promise<void>(resolve => server.listen(45435, "127.0.0.1", resolve));
});
test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve())); expect(inventory()).toEqual(sealed);
  const folder = output(test.info());
  fs.writeFileSync(path.join(folder, "sealed-build.json"), JSON.stringify({ files: sealed.length, unchanged: true, inventorySHA256: hash(JSON.stringify(sealed)), componentSourceSHA256: hash(fs.readFileSync(path.join(root, "frontend/src/components/PineChartNotices.tsx"))) }, null, 2));
});
function output(info: TestInfo) { const folder = path.join(root, ".artifacts/chart-notices135", info.project.name); fs.mkdirSync(folder, { recursive: true }); return folder; }
async function screenshot(page: Page, info: TestInfo, name: string) { await page.screenshot({ path: path.join(output(info), name + ".png"), animations: "disabled" }); }
async function box(locator: Locator) { const result = await locator.boundingBox(); expect(result).not.toBeNull(); return result!; }
async function toggle(summary: Locator, key: "Enter" | "Space") { await summary.focus(); await summary.press(key); }
const semanticPalette = { "--warning-soft": "#e6dbbd", "--warning-text": "#493b0f", "--loss-soft": "#edd8d8", "--loss-text": "#6d1a1a", "--ui-inset": "#e4ded7", "--text-secondary": "#45423e", "--ui-border-subtle": "#928574", "--ui-focus": "#362064" };
async function palette(page: Page) { await page.evaluate(tokens => { for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value); }, semanticPalette); }
async function theme(locator: Locator, textToken: string | null, backgroundToken: string) {
  const result = await locator.evaluate((element, { textToken, backgroundToken }) => {
    const resolve = (token: string) => { const sample = document.createElement("span"); sample.style.color = `var(${token})`; document.body.append(sample); const value = getComputedStyle(sample).color; sample.remove(); return value; };
    const style = getComputedStyle(element);
    return { text: style.color, expectedText: textToken ? resolve(textToken) : null, background: style.backgroundColor, expectedBackground: resolve(backgroundToken), border: style.borderTopColor, expectedBorder: resolve("--ui-border-subtle") };
  }, { textToken, backgroundToken });
  if (textToken) expect(result.text).toBe(result.expectedText); expect(result.background).toBe(result.expectedBackground); expect(result.border).toBe(result.expectedBorder);
  return result;
}
async function canvasPixels(chart: Locator) {
  return chart.locator("canvas").evaluateAll(canvases => {
    let background = 0, text = 0, pixels = 0;
    for (const node of canvases) {
      const canvas = node as HTMLCanvasElement, data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      pixels += canvas.width * canvas.height;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 231 && data[i + 1] === 223 && data[i + 2] === 206 && data[i + 3] === 255) background++;
        if (data[i] === 18 && data[i + 1] === 52 && data[i + 2] === 86 && data[i + 3] > 0) text++;
      }
    }
    return { background, text, pixels };
  });
}
const source = `//@version=6
indicator("Notice135 study", overlay=false, behind_chart=false)
plot(close-close[1])
plot(ta.sma(close-close[1],3),"Smoothed change")
if barstate.islast
    points=array.from(chart.point.from_index(bar_index-25,close[25]),chart.point.from_index(bar_index-12,high[12]),chart.point.from_index(bar_index-4,low[4]),chart.point.from_index(bar_index,close))
    polyline.new(points,curved=true,line_color=#ff00ff,line_width=3,force_overlay=true)`;
async function nativeResult(page: Page) {
  return page.evaluate(source => ((window as any).__layerResults ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    return response?.status === "completed" && response.result.kind === "run" && response.result.source === source ? [response.result] : [];
  }).at(-1), source);
}
test("production chart keeps real drawing warnings compact and accessible while separate pane names stay behind a disclosure", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); const state = await productSetup(page);
  const baseline = await box(page.locator(".chart-stage .tv-lightweight-charts").first());
  const dialog = await editor(page); await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source); await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled(); await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click(); await expect.poll(() => nativeResult(page)).toBeTruthy();
  const result = await nativeResult(page); expect(result.polylines).toHaveLength(1); expect(result.polylines[0].curved).toBe(true); expect(result.polylines[0].forceOverlay).toBe(true); expect(result.plots).toHaveLength(2);
  const notices = page.locator('details[aria-label="Indicator notices"]'), summary = notices.locator("summary");
  await expect(summary).toHaveText("Chart notices (1)"); await expect(notices).not.toHaveAttribute("open", "");
  const compact = await box(notices); expect(compact.height).toBeGreaterThanOrEqual(44); expect(compact.height).toBeLessThanOrEqual(56);
  await expect(page.getByRole("region", { name: "Indicator notice details", exact: true })).toBeHidden(); await expect(page.getByRole("alert")).toHaveCount(0);
  const chart = await box(page.locator(".chart-stage .tv-lightweight-charts").first()); expect(chart.height).toBeGreaterThanOrEqual(baseline.height * .7);
  await screenshot(page, info, "production-compact"); await toggle(summary, "Enter");
  const details = page.getByRole("region", { name: "Indicator notice details", exact: true }); await expect(details).toBeVisible(); await expect(details.getByRole("listitem")).toHaveText(polylineWarning); await expect(details).toContainText("Notice135 study");
  const expanded = await box(details); expect(expanded.height).toBeLessThanOrEqual(224); await details.focus(); await expect(details).toBeFocused();
  await screenshot(page, info, "production-expanded"); await toggle(summary, "Space"); await expect(details).toBeHidden(); expect((await box(notices)).height).toBe(compact.height);
  const assumptions = page.locator('details[aria-label="Pine execution assumptions"]'), assumptionSummary = assumptions.locator("summary");
  await expect(assumptionSummary).toHaveText("Candle snapshot"); await toggle(assumptionSummary, "Enter");
  await expect(page.getByRole("region", { name: "Assumption details and affected scripts", exact: true })).toContainText("CLOSED_BAR_SNAPSHOT"); await toggle(assumptionSummary, "Space");
  const pane = page.getByRole("region", { name: "Notice135 study native Pine pane", exact: true });
  const outputSummary = pane.locator("details summary"); await expect(outputSummary).toHaveText("2 outputs"); const names = pane.getByRole("region", { name: "Notice135 study output names", exact: true }); await expect(names).toBeHidden();
  expect(await pane.locator(".mb-2").innerText()).not.toContain("Native Pine"); expect(await pane.locator(".mb-2").innerText()).not.toContain("#0");
  await toggle(outputSummary, "Enter"); await expect(names).toHaveText(result.plots.map((plot: any) => plot.name).join(" · ")); await expect(names).toContainText("Smoothed change"); await names.focus(); await expect(names).toBeFocused(); await toggle(outputSummary, "Space"); await expect(names).toBeHidden();
  const mainChart = page.locator(".chart-stage .tv-lightweight-charts").first(), nativeChart = pane.locator(".tv-lightweight-charts");
  await page.evaluate(() => { (window as any).__notice135CanvasNodes = [document.querySelector(".chart-stage .tv-lightweight-charts canvas"), document.querySelector('[aria-label="Notice135 study native Pine pane"] canvas')]; });
  const settingsTrigger = page.locator(".chart-studio-toolbar").getByRole("button", { name: "Settings", exact: true });
  if (!await settingsTrigger.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await settingsTrigger.click(); const settings = page.getByRole("dialog", { name: "Chart settings", exact: true }); await expect(settings).toBeVisible();
  await settings.getByRole("navigation", { name: "Chart settings sections", exact: true }).getByRole("button", { name: "Canvas", exact: true }).click();
  await settings.getByRole("textbox", { name: "Background hex code", exact: true }).fill("#E7DFCE"); await settings.getByRole("textbox", { name: "Background hex code", exact: true }).press("Enter");
  await settings.getByRole("textbox", { name: "Text hex code", exact: true }).fill("#123456"); await settings.getByRole("textbox", { name: "Text hex code", exact: true }).press("Enter");
  await settings.getByRole("button", { name: "Close chart settings", exact: true }).click();
  const appearance: any[] = [];
  for (const chart of [mainChart, nativeChart]) { await expect.poll(async () => (await canvasPixels(chart)).background).toBeGreaterThan(300); await expect.poll(async () => (await canvasPixels(chart)).text).toBeGreaterThan(0); const measured = await canvasPixels(chart); expect(measured.background).toBeGreaterThan(measured.pixels * .15); appearance.push(measured); }
  expect(await page.evaluate(() => (window as any).__notice135CanvasNodes.every((node: Node, index: number) => node === (index === 0 ? document.querySelector(".chart-stage .tv-lightweight-charts canvas") : document.querySelector('[aria-label="Notice135 study native Pine pane"] canvas'))))).toBe(true);
  await screenshot(page, info, "production-chart-appearance");
  await palette(page); const colors = { warning: await theme(notices.locator(".."), "--warning-text", "--warning-soft"), assumptions: await theme(assumptions.locator(".."), "--text-secondary", "--ui-inset"), pane: await theme(pane, null, "--ui-inset") };
  expect(await outputSummary.evaluate(element => getComputedStyle(element).color)).toBe("rgb(69, 66, 62)");
  await screenshot(page, info, "production-semantic-palette");
  const name = fs.readdirSync(path.join(dist, "assets")).find(name => /^pine-native-worker.*\.js$/.test(name))!, bytes = fs.readFileSync(path.join(dist, "assets", name));
  expect(state.workerReceipts.length).toBeGreaterThan(0); expect(state.workerReceipts.every(receipt => receipt.bytes === bytes.length && receipt.sha256 === hash(bytes))).toBe(true); expect(errors).toEqual([]);
  fs.writeFileSync(path.join(output(info), "production.json"), JSON.stringify({ scope: "Actual production replay app, editor, worker and chart; only API/auth/storage mocked. Actual chart-settings UI changes separately verified with canvas pixels; injected palette checks semantic inheritance only.", baseline, compact, chart, expanded, result, colors, appearance, workerName: name, workerSHA256: hash(bytes), workerReceipts: state.workerReceipts, errors }, null, 2));
});

test("actual notice component keeps severe failures visible and offers readable closed live and mixed execution details with keyboard and theme support", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); await page.goto("http://127.0.0.1:45435/");
  const alert = page.getByRole("alert"); await expect(alert).toHaveText("Failed study: CALCULATION_FAILED: This study cannot calculate its result.");
  const notices = page.locator('details[aria-label="Indicator notices"]'), summary = notices.locator("summary"); await expect(summary).toHaveText("Chart notices (2)");
  await expect(page.getByRole("region", { name: "Indicator notice details", exact: true })).toBeHidden(); expect((await box(notices)).height).toBeLessThanOrEqual(56);
  await toggle(summary, "Enter"); const region = page.getByRole("region", { name: "Indicator notice details", exact: true }); await expect(region).toBeVisible();
  await expect(region).toContainText(polylineWarning); await expect(region).toContainText("RENDERING_NOTE"); await expect(region).not.toContainText("CALCULATION_FAILED");
  await region.focus(); await expect(region).toBeFocused(); expect((await box(region)).height).toBeLessThanOrEqual(224);
  const bounds = await region.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth })); expect(bounds.scrollWidth).toBeLessThanOrEqual(Math.ceil(bounds.width) + 1);
  await toggle(summary, "Space"); await expect(region).toBeHidden(); await expect(alert).toBeVisible();
  await palette(page); const colors = { error: await theme(alert, "--loss-text", "--loss-soft"), warning: await theme(notices.locator(".."), "--warning-text", "--warning-soft") }; await screenshot(page, info, "component-error-and-compact-notices");
  const labels: unknown[] = [];
  for (const [variant, label] of [["closed", "Candle snapshot"], ["live", "Live chart updates"], ["mixed", "Calculation details"]]) {
    await page.evaluate(variant => (window as any).notices135.show(variant), variant);
    const execution = page.locator('details[aria-label="Pine execution assumptions"]'), executionSummary = execution.locator("summary");
    await expect(executionSummary).toHaveText(label); await expect(execution).not.toHaveAttribute("open", ""); await toggle(executionSummary, "Enter");
    const details = page.getByRole("region", { name: "Assumption details and affected scripts", exact: true }); await expect(details).toBeVisible(); await expect(details).toContainText("Applies to:");
    if (variant === "mixed") { await expect(details).toContainText("Completed study"); await expect(details).toContainText("Live study"); }
    const measured = await theme(execution.locator(".."), "--text-secondary", "--ui-inset"); labels.push({ variant, label, measured, details: await details.innerText() }); await toggle(executionSummary, "Space"); await expect(details).toBeHidden();
  }
  expect(errors).toEqual([]); fs.writeFileSync(path.join(output(info), "component.json"), JSON.stringify({ scope: "Actual PineChartNotices component with explicit diagnostic props and sealed production CSS; no Pine execution or live-feed claim", bounds, colors, labels, errors }, null, 2));
});
