import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { AUTH_SESSION_KEY, betaSessionResponse, FROZEN_TIME, gotoStable } from "./support/app";
import { bars, fulfillReplayContext, prepare } from "./support/replay-context";
import type { PineExecutionResult, PineResponse } from "../frontend/src/lib/pineProtocol";

const overlay = '//@version=5\nindicator("Native editor EMA", overlay=true)\nlength=input.int(3,"Length",minval=1,maxval=20)\nplot(ta.ema(close,length),"Native EMA",color=#ff00ff)';
const paneSource = '//@version=6\nindicator("Native editor RSI", overlay=false)\nlength=input.int(3,"Length",minval=1,maxval=20)\nplot(ta.rsi(close,length),"Native RSI",color=#ff00ff)';
const strategy = '//@version=6\nstrategy("Native editor ledger", initial_capital=1000000)\nif bar_index == 1\n    strategy.entry("Closed", strategy.long, qty=2)\nif bar_index == 3\n    strategy.close("Closed")\nif bar_index == 6\n    strategy.entry("Open", strategy.long, qty=1)\nif barstate.islast\n    strategy.entry("Pending", strategy.short, qty=1)';
const artifacts = path.resolve(".artifacts/pine-editor27");
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
        if (event.data.payload?.status === "completed" && (window.__nativeEditorHoldRun && event.data.payload.result?.kind === "run" || window.__nativeEditorHoldPrepare && event.data.payload.result?.kind === "prepare")) {
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

async function releaseNativeResult(page: Page) {
  const release = await page.evaluate(() => {
    window.__nativeEditorHoldPrepare = false;
    window.__nativeEditorHoldRun = false;
    // A fresh envelope clears the stopped event's propagation flags; payload and frame identity stay exact.
    const held = window.__nativeEditorHeldResult!;
    const late = new MessageEvent("message", { data: held.data, source: held.source, origin: held.origin, ports: [...held.ports] });
    let delivered = false;
    const observe = (event: MessageEvent) => { if (event === late) delivered = true; };
    window.addEventListener("message", observe);
    window.dispatchEvent(late);
    window.removeEventListener("message", observe);
    window.__nativeEditorHeldResult = null;
    return { delivered, samePayload: late.data === held.data, sameSource: late.source === held.source, sameOrigin: late.origin === held.origin };
  });
  expect(release).toEqual({ delivered: true, samePayload: true, sameSource: true, sameOrigin: true });
}

async function nativeRun(page: Page, source: string) {
  await expect.poll(() => page.evaluate((expected) => window.__nativeEditorResults.filter((item) => item.status === "completed" && item.result.kind === "run" && item.result.source === expected).length, source)).toBeGreaterThan(0);
  return page.evaluate((expected) => {
    const found = [...window.__nativeEditorResults].reverse().find((item) => item.status === "completed" && item.result.kind === "run" && item.result.source === expected);
    return found?.status === "completed" ? found.result as PineExecutionResult : null;
  }, source).then((result) => { expect(result).not.toBeNull(); return result!; });
}

test("native Pine inputs persist through save, reload, revisions and duplication", async ({ page }, info) => {
  const state = await fixture(page);
  let editor = await openEditor(page);
  await fillSource(editor, overlay);
  const sourceBox = await editor.getByLabel("EdgeLab indicator source", { exact: true }).boundingBox();
  const diagnosticsBox = await editor.getByRole("heading", { name: "Diagnostics", exact: true }).boundingBox();
  expect(sourceBox!.width).toBeGreaterThanOrEqual(info.project.name === "desktop" ? 400 : 300);
  expect(sourceBox!.height).toBeGreaterThanOrEqual(250);
  if (info.project.name === "desktop") expect(sourceBox!.x + sourceBox!.width).toBeLessThanOrEqual(diagnosticsBox!.x);
  const mirror = editor.locator("main pre[aria-hidden='true']");
  await expect(mirror).toHaveText(overlay);
  expect((await mirror.boundingBox())!.width).toBeGreaterThanOrEqual(info.project.name === "desktop" ? 400 : 300);
  const codeImage = await editor.getByLabel("EdgeLab indicator source", { exact: true }).screenshot();
  const paintedCode = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let bright = 0;
    const rows = new Set<number>();
    for (let y = 8; y < canvas.height - 8; y++) for (let x = 8; x < canvas.width - 8; x++) {
      const offset = (y * canvas.width + x) * 4;
      if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 420 && pixels[offset + 3] > 200) { bright++; rows.add(y); }
    }
    return { bright, rows: rows.size };
  }, codeImage.toString("base64"));
  expect(paintedCode.bright).toBeGreaterThan(80);
  expect(paintedCode.rows).toBeGreaterThan(6);
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await check(editor);
  await editor.getByLabel("Length", { exact: true }).fill("5");
  await run(editor);
  const result = await nativeRun(page, overlay);
  expect(result.inputs).toMatchObject({ in_0: 5 });
  expect(result.audit).toMatchObject({ engine: "PineTS", engineVersion: "0.11.0", mode: "historical" });
  const closes = bars.filter((bar) => bar.time <= result.plots[0].points.at(-1)!.time).map((bar) => bar.close);
  const expected = closes.reduce((ema, close, index) => index === 0 ? close : close / 3 + ema * 2 / 3, 0);
  expect(result.plots[0].points.at(-1)!.value).toBeCloseTo(expected, 8);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => (state.storage.get("custom-indicator-scripts.v1") as Array<{ name: string }> | undefined)?.some((script) => script.name === "Native editor EMA")).toBe(true);
  const saved = (state.storage.get("custom-indicator-scripts.v1") as Array<Record<string, unknown>>).find((script) => script.name === "Native editor EMA")!;
  expect(saved).toMatchObject({ source: overlay, inputs: { in_0: 5 }, pinePrepared: { language: "pine", source: overlay }, revision: 1 });
  await page.reload();
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  editor = await openEditor(page);
  await editor.getByLabel("Script library", { exact: true }).selectOption(String(saved.id));
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(overlay);
  await check(editor);
  await expect(editor.getByLabel("Length", { exact: true })).toHaveValue("5");
  const revised = overlay.replace("ta.ema(close,length)", "ta.ema(close,length) + 1");
  await fillSource(editor, revised);
  await check(editor);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByLabel("Script library", { exact: true }).locator("option:checked")).toContainText("v2");
  await editor.getByLabel("Version history", { exact: true }).selectOption("1");
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(overlay);
  await check(editor);
  await editor.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(overlay);
  await expect(editor.getByLabel("Script library", { exact: true }).locator("option:checked")).toContainText("Native editor EMA copy");
  await expect.poll(() => (state.storage.get("custom-indicator-scripts.v1") as unknown[]).length).toBe(2);
  await editor.getByLabel("EdgeLab indicator source", { exact: true }).focus();
  await page.keyboard.press("Tab");
  fs.mkdirSync(artifacts, { recursive: true });
  await editor.screenshot({ path: path.join(artifacts, `editor-${info.project.name}.png`) });
});

for (const placement of ["overlay", "pane"]) test(`large packed ${placement} saves, reloads and keeps all 64 outputs accessible`, async ({ page }, info) => {
  const state = await fixture(page), editor = await openEditor(page);
  const source = `//@version=6\nindicator("Packed editor",overlay=${placement === "overlay"})\n` + Array.from({ length: 64 }, (_, index) => `plot(close + ${index},"Channel ${index}")`).join("\n");
  await fillSource(editor, source); await check(editor); await run(editor);
  await expect(editor.locator("#edge-editor-diagnostics")).toContainText("64 plots");
  expect(await page.evaluate((source) => window.__nativeEditorResults.some((item) => item.status === "completed" && item.result.kind === "run" && item.result.source === source && "encoding" in item && item.encoding === "pine-packed-v1"), source)).toBe(true);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => (state.storage.get("custom-indicator-scripts.v1") as unknown[] | undefined)?.length).toBe(1);
  const saved = (state.storage.get("custom-indicator-scripts.v1") as Array<Record<string, unknown>>)[0];
  expect(saved.source).toBe(source);
  expect(Object.keys(saved.pinePrepared as object).sort()).toEqual(["declaration", "diagnostics", "inputDefinitions", "kind", "language", "name", "overlay", "pineVersion", "source"].sort());
  await page.reload(); await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  const reopened = await openEditor(page);
  await reopened.getByLabel("Script library", { exact: true }).selectOption(String(saved.id));
  await expect(reopened.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(source);
  await expect(reopened.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await reopened.getByRole("button", { name: "Add to chart", exact: true }).click();
  await reopened.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const outputs = page.locator(".chart-study-row details");
  await expect(outputs.locator("summary")).toHaveText("64 outputs");
  const edit = page.locator(".chart-study-row").getByRole("button", { name: String(saved.name), exact: true });
  await expect(edit).toBeVisible();
  await expect(outputs.locator("button.chart-study-pill")).toHaveCount(64);
  await expect(outputs.locator("button.chart-study-pill").first()).toBeHidden();
  await outputs.locator("summary").focus(); await page.keyboard.press("Enter");
  await expect(outputs.locator("button.chart-study-pill").first()).toBeVisible();
  const body = outputs.locator("div").first();
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const last = outputs.getByRole("button").filter({ hasText: "Channel 63" });
  await last.scrollIntoViewIfNeeded(); await expect(last).toBeVisible();
  await last.focus(); await expect(last).toBeFocused();
  const captures = path.resolve(".artifacts/pine-visuals33/product");
  fs.mkdirSync(captures, { recursive: true });
  await outputs.screenshot({ path: path.join(captures, `packed-${placement}-outputs-${info.project.name}.png`) });
  await outputs.locator("summary").click(); await expect(last).toBeHidden();
  await expect(edit).toBeVisible();
  const assumptions = page.getByRole("status").filter({ hasText: "CLOSED_BAR_SNAPSHOT:" }).locator("details");
  await expect(assumptions.locator("summary")).toContainText("Closed historical snapshot");
  await expect(assumptions.locator("p")).toBeHidden();
  await assumptions.locator("summary").focus(); await page.keyboard.press("Enter");
  await expect(assumptions.locator("p")).toBeVisible();
  await expect(assumptions.locator("p")).toContainText("realtime rollback");
  await assumptions.locator("summary").click();
  if (placement === "pane") {
    const pane = page.getByRole("region", { name: `${String(saved.name)} native Pine pane` });
    await expect(pane).toBeVisible();
    await expect(pane.locator("details summary")).toHaveText("Native Pine · 64 outputs");
    await expect(pane.locator("canvas").first()).toBeVisible();
    await pane.locator("details summary").focus(); await page.keyboard.press("Enter");
    const names = pane.locator("details p");
    await expect(names).toContainText("Channel 63");
    await names.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await pane.screenshot({ path: path.join(captures, `packed-native-pane-expanded-${info.project.name}.png`) });
    await pane.locator("details summary").click();
    await pane.screenshot({ path: path.join(captures, `packed-native-pane-${info.project.name}.png`) });
  }
  await expect.poll(() => page.locator(".chart-stage").first().evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator(".chart-stage").first().getByRole("table", { name: /recent price bars/ }).getByRole("row")).toHaveCount(6);
  await edit.focus();
  await page.locator(".chart-stage").first().evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
  await expect(edit).toBeFocused();
  await page.screenshot({ path: path.join(captures, `packed-${placement}-${info.project.name}.png`) });
});

test("native gradient custom inputs survive save and reload and paint the actual pane", async ({ page }, info) => {
  const state = await fixture(page);
  let editor = await openEditor(page);
  const source = '//@version=6\nindicator("Native editor gradient",overlay=false)\ntop=input.float(100,"Gradient top",minval=80,maxval=200)\nbottom=input.float(0,"Gradient bottom",minval=-100,maxval=20)\ntopColor=input.color(#ff0000,"Top color")\nbottomColor=input.color(#0000ff,"Bottom color")\na=plot(80,"Mask upper",display=display.none)\nb=plot(20,"Mask lower",display=display.none)\nfill(a,b,top,bottom,topColor,bottomColor,title="Gradient mask")';
  await fillSource(editor, source); await check(editor);
  await editor.getByLabel("Gradient top", { exact: true }).fill("120");
  await editor.getByLabel("Top color", { exact: true }).fill("#ff0000");
  await editor.getByLabel("Bottom color", { exact: true }).fill("#0000ff");
  await run(editor);
  const result = await nativeRun(page, source);
  expect(result.inputs).toMatchObject({ in_0: 120, in_1: 0, in_2: "#ff0000", in_3: "#0000ff" });
  const fill = result.plots.find((plot) => plot.style === "fill")!;
  expect(fill.options.gradient).toBe(true);
  expect(fill.points.at(-1)!.options).toMatchObject({ top_value: 120, bottom_value: 0 });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => (state.storage.get("custom-indicator-scripts.v1") as unknown[] | undefined)?.length).toBe(1);
  const saved = (state.storage.get("custom-indicator-scripts.v1") as Array<Record<string, unknown>>)[0];
  expect(saved).toMatchObject({ source, inputs: result.inputs });
  await page.reload(); await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  editor = await openEditor(page);
  await editor.getByLabel("Script library", { exact: true }).selectOption(String(saved.id));
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(source);
  await check(editor);
  await expect(editor.getByLabel("Gradient top", { exact: true })).toHaveValue("120");
  await editor.getByRole("button", { name: "Add to chart", exact: true }).click();
  await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const pane = page.getByRole("region", { name: "Native editor gradient native Pine pane", exact: true });
  await expect(pane).toBeVisible();
  await expect(page.getByText(/Gradient fills are not rendered/)).toHaveCount(0);
  await expect.poll(() => pane.locator("canvas").evaluateAll((canvases) => {
    const colored: Array<{ y: number; red: number; blue: number }> = [];
    for (const canvas of canvases) {
      const element = canvas as HTMLCanvasElement;
      const pixels = element.getContext("2d")?.getImageData(0, 0, element.width, element.height).data;
      if (!pixels) continue;
      for (let y = 0; y < element.height; y++) for (let x = 0; x < element.width; x++) {
        const offset = (y * element.width + x) * 4;
        const [red, green, blue] = pixels.slice(offset, offset + 3);
        if (red > green * 2 && blue > green * 2 && red + blue > 150) colored.push({ y: y / element.height, red, blue });
      }
    }
    const top = colored.filter((pixel) => pixel.y < 0.4), bottom = colored.filter((pixel) => pixel.y > 0.6);
    return {
      topCount: top.length, bottomCount: bottom.length,
      topRed: top.length ? top.reduce((sum, pixel) => sum + pixel.red, 0) / top.length : 0,
      bottomRed: bottom.length ? bottom.reduce((sum, pixel) => sum + pixel.red, 0) / bottom.length : 0,
      topBlue: top.length ? top.reduce((sum, pixel) => sum + pixel.blue, 0) / top.length : 0,
      bottomBlue: bottom.length ? bottom.reduce((sum, pixel) => sum + pixel.blue, 0) / bottom.length : 0,
    };
  }).then((pixels) => pixels.topCount > 100 && pixels.bottomCount > 100 && pixels.topRed > pixels.bottomRed + 40 && pixels.bottomBlue > pixels.topBlue + 40)).toBe(true);
  await pane.getByRole("button", { name: "Native editor gradient", exact: true }).focus();
  const captures = path.resolve(".artifacts/pine-gradients34/product");
  fs.mkdirSync(captures, { recursive: true });
  await pane.screenshot({ path: path.join(captures, `gradient-pane-${info.project.name}.png`) });
});

test("native horizontal level inputs survive save reload and paint the actual pane", async ({ page }, info) => {
  const state = await fixture(page);
  let editor = await openEditor(page);
  const source = '//@version=6\nindicator("Native editor levels",overlay=false)\nprice=input.float(100,"Level price")\nshade=input.color(#ff0000,"Level color")\nshow=input.bool(true,"Show level")\nhline(show?price:na,"Editable level",shade,hline.style_dashed,3,false,display.all)\nhline(0,"Zero",#0000ff,hline.style_solid,2)\nhline(120,"Upper",#00ff00,hline.style_dotted,2)';
  await fillSource(editor, source); await check(editor);
  await editor.getByLabel("Level price", { exact: true }).fill("80");
  await editor.getByLabel("Level color", { exact: true }).fill("#ff0000");
  await run(editor);
  const result = await nativeRun(page, source);
  expect(result.inputs).toMatchObject({ in_0: 80, in_1: "#ff0000", in_2: true });
  const level = result.plots.find((plot) => plot.name === "Editable level")!;
  expect(level.style).toBe("hline");
  expect(level.options).toMatchObject({ linewidth: 3, editable: false, linestyle: "dashed" });
  expect(level.points.at(-1)!.value).toBe(80);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => (state.storage.get("custom-indicator-scripts.v1") as unknown[] | undefined)?.length).toBe(1);
  const saved = (state.storage.get("custom-indicator-scripts.v1") as Array<Record<string, unknown>>)[0];
  expect(saved).toMatchObject({ source, inputs: result.inputs });
  await page.reload(); await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  editor = await openEditor(page);
  await editor.getByLabel("Script library", { exact: true }).selectOption(String(saved.id));
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(source);
  await check(editor);
  await expect(editor.getByLabel("Level price", { exact: true })).toHaveValue("80");
  await editor.getByRole("button", { name: "Add to chart", exact: true }).click();
  await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const pane = page.getByRole("region", { name: "Native editor levels native Pine pane", exact: true });
  await expect(pane).toBeVisible();
  await expect.poll(() => pane.locator("canvas").evaluateAll((canvases) => {
    let drawn = false;
    for (const canvas of canvases) {
      const element = canvas as HTMLCanvasElement, pixels = element.getContext("2d")?.getImageData(0, 0, element.width, element.height).data;
      if (!pixels) continue;
      const counts = [0, 0, 0];
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const rgb = [...pixels.slice(offset, offset + 3)];
        for (let lane = 0; lane < 3; lane++) if (rgb[lane] > 120 && rgb[lane] > rgb[(lane + 1) % 3] * 1.5 && rgb[lane] > rgb[(lane + 2) % 3] * 1.5) counts[lane]++;
      }
      if (counts.every((count) => count > element.width * .2)) drawn = true;
    }
    return drawn;
  })).toBe(true);
  await expect(page.getByText(/Native hline output is not rendered/)).toHaveCount(0);
  const captures = path.resolve(".artifacts/pine-levels36/product"); fs.mkdirSync(captures, { recursive: true });
  await pane.screenshot({ path: path.join(captures, `levels-pane-${info.project.name}.png`) });
});

test("plot names matching assumption codes keep unsupported-output warnings visible", async ({ page }) => {
  await fixture(page);
  const editor = await openEditor(page);
  const codes = ["CLOSED_BAR_SNAPSHOT", "SNAPSHOT_CONTEXT", "DEFAULT_SYMBOL_METADATA"];
  const source = `//@version=6\nindicator("Warning names",overlay=true)\nplot(close,"Price")\n` + codes.map((code) => `plot(close,"${code}",offset=1)`).join("\n");
  await fillSource(editor, source); await check(editor);
  await editor.getByRole("button", { name: "Add to chart", exact: true }).click();
  await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const status = page.getByRole("status").filter({ hasText: "Warning names:" });
  for (const code of codes) await expect(status).toContainText(`${code}: Plot offsets are not rendered`);
  await expect(status.locator("details p")).toBeHidden();
  const exposed = await status.evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelector("details")?.remove();
    return copy.textContent;
  });
  for (const code of codes) expect(exposed).toContain(`${code}: Plot offsets are not rendered`);
});

test("native overlay and oscillator reach real chart canvases", async ({ page }, info) => {
  await fixture(page);
  for (const source of [overlay, paneSource]) {
    const editor = await openEditor(page);
    await fillSource(editor, source);
    await check(editor);
    await editor.getByRole("button", { name: "Add to chart", exact: true }).click();
    await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
    const result = await nativeRun(page, source);
    expect(result.plots[0].overlay).toBe(source === overlay);
    expect(result.plots[0].points.filter((point) => typeof point.value === "number").length).toBeGreaterThan(50);
    const last = result.plots[0].points.at(-1)!;
    const headerValue = source === overlay
      ? bars.filter((bar) => bar.time <= last.time).reduce((ema, bar, index) => index === 0 ? bar.close : (bar.close + ema) / 2, 0)
      : last.value as number;
    await expect(page.locator("button.chart-study-pill").filter({ hasText: result.name }).last()).toContainText(headerValue.toFixed(4));
  }
  await expect(page.getByText("Native editor EMA", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Native editor RSI", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Native editor RSI native Pine pane", exact: true })).toBeVisible();
  await expect.poll(() => page.locator(".chart-stage canvas").evaluateAll((canvases) => {
    const painted = { overlay: false, pane: false };
    for (const canvas of canvases) {
      const element = canvas as HTMLCanvasElement;
      const pixels = element.getContext("2d")?.getImageData(0, 0, element.width, element.height).data;
      if (!pixels) continue;
      let magenta = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] > 220 && pixels[offset + 1] < 40 && pixels[offset + 2] > 220 && pixels[offset + 3] > 100) magenta++;
      if (magenta > 20) painted[canvas.closest('[aria-label="Native editor RSI native Pine pane"]') ? "pane" : "overlay"] = true;
    }
    return painted;
  })).toEqual({ overlay: true, pane: true });
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `chart-${info.project.name}.png`) });
});

test("native strategy presents actual closed, open and pending engine records", async ({ page }, info) => {
  await fixture(page);
  const editor = await openEditor(page);
  await fillSource(editor, strategy);
  await check(editor);
  await run(editor);
  const result = await nativeRun(page, strategy);
  expect(result.strategy!.closedTrades).toHaveLength(1);
  expect(result.strategy!.openTrades).toHaveLength(1);
  expect(result.strategy!.pendingOrders).toHaveLength(1);
  const trade = result.strategy!.closedTrades[0];
  expect(trade).toMatchObject({ entry_bar_index: 2, exit_bar_index: 4, size: 2 });
  expect(trade.profit).toBeCloseTo((bars[4].open - bars[2].open) * 2, 7);
  const region = editor.getByRole("region", { name: "Pine strategy results" });
  await expect(region).toBeVisible();
  for (const name of ["Closed trades", "Open trades", "Pending orders"]) await expect(region.getByRole("table", { name }).getByRole("row")).toHaveCount(2);
  expect(await editor.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  if (info.project.name === "mobile") {
    for (const section of [editor.locator("#edge-editor-diagnostics"), region]) {
      const bounds = await section.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
    }
    const ledger = region.getByLabel("Closed trades ledger", { exact: true });
    expect(await ledger.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await ledger.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    expect(await ledger.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await ledger.evaluate((element) => { element.scrollLeft = 0; });
  }
  await region.getByRole("heading", { name: "Pine strategy results", exact: true }).scrollIntoViewIfNeeded();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `strategy-${info.project.name}.png`) });
  if (info.project.name === "mobile") {
    await region.getByRole("table", { name: "Pending orders" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, "strategy-mobile-pending.png") });
  }
});

test("Pine templates prepare natively and a stale source check cannot enable saving", async ({ page }) => {
  await fixture(page);
  const editor = await openEditor(page);
  for (const template of ["pine-indicator", "pine-strategy"]) {
    await editor.getByLabel("New script template", { exact: true }).selectOption(template);
    const source = await editor.getByLabel("EdgeLab indicator source", { exact: true }).inputValue();
    expect(source).toMatch(/^\/\/@version=[56]/);
    await check(editor);
    await run(editor);
    expect((await nativeRun(page, source)).declaration).toBe(template === "pine-strategy" ? "strategy" : "indicator");
  }
  await fillSource(editor, overlay);
  await page.evaluate(() => { window.__nativeEditorHoldPrepare = true; });
  await editor.getByRole("button", { name: "Check script", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__nativeEditorHeldResult))).toBe(true);
  expect(await page.evaluate(() => window.__nativeEditorHeldResult?.data.payload.result)).toMatchObject({ kind: "prepare", source: overlay, language: "pine", declaration: "indicator" });
  await fillSource(editor, paneSource);
  await expect.poll(() => page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0);
  await releaseNativeResult(page);
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await check(editor);
  await run(editor);
  expect((await nativeRun(page, paneSource)).overlay).toBe(false);
});

test("Quant executes saved native order rules and refuses indicator crossing backtests", async ({ page }, info) => {
  const state = await fixture(page);
  for (const source of [strategy, overlay]) {
    const editor = await openEditor(page);
    await fillSource(editor, source);
    await check(editor);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  }
  await expect.poll(() => (state.storage.get("custom-indicator-scripts.v1") as unknown[] | undefined)?.length).toBe(2);
  const saved = state.storage.get("custom-indicator-scripts.v1") as Array<{ id: string; source: string }>;
  const quantTrigger = page.getByRole("button", { name: "Quant", exact: true });
  if (!await quantTrigger.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await quantTrigger.click();
  const panel = page.getByRole("complementary", { name: "Quant assistant" });
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-quant-state="provider-loading"]')).toHaveCount(0);
  await panel.getByRole("tab", { name: "Build & backtest", exact: true }).click();
  await panel.getByRole("combobox", { name: "Indicator", exact: true }).selectOption(saved.find((script) => script.source === strategy)!.id);
  await expect(panel.getByRole("heading", { name: "Pine strategy test", exact: true })).toBeVisible();
  for (const name of ["Capital", "Days", "Commission bps", "Slippage bps"]) await expect(panel.getByRole("spinbutton", { name, exact: true })).toHaveCount(0);
  await expect(panel.getByRole("combobox", { name: "Rules", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  const result = await nativeRun(page, strategy);
  expect(result.strategy!.closedTrades).toHaveLength(1);
  expect(result.strategy!.closedTrades[0].profit).toBeCloseTo((bars[4].open - bars[2].open) * 2, 7);
  const ledger = panel.getByRole("region", { name: "Pine strategy results" });
  await expect(ledger.getByRole("table", { name: "Closed trades" }).getByRole("cell", { name: "Closed", exact: true })).toBeVisible();
  await expect(ledger.getByRole("table", { name: "Open trades" }).getByRole("cell", { name: "Open", exact: true })).toBeVisible();
  await expect(ledger.getByRole("table", { name: "Pending orders" }).getByRole("cell", { name: "Pending", exact: true })).toBeVisible();
  await ledger.getByRole("heading", { name: "Pine strategy results", exact: true }).scrollIntoViewIfNeeded();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `quant-strategy-${info.project.name}.png`) });
  await panel.getByRole("combobox", { name: "Indicator", exact: true }).selectOption(saved.find((script) => script.source === overlay)!.id);
  await page.evaluate(() => { window.__nativeEditorResults = []; });
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("no order rules");
  await expect(panel.getByRole("region", { name: "Pine strategy results" })).toHaveCount(0);
  await expect(panel.getByText("Sample hash", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__nativeEditorResults.filter((item) => item.status === "completed" && item.result.kind === "run").length)).toBe(0);
});

for (const change of ["source", "input", "cancel"] as const) {
  test(`${change} invalidates a pending actual native run before publication`, async ({ page }) => {
    await fixture(page);
    const editor = await openEditor(page);
    await fillSource(editor, overlay);
    await check(editor);
    await page.evaluate(() => { window.__nativeEditorHoldRun = true; });
    await editor.getByRole("button", { name: "Run", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__nativeEditorHeldResult))).toBe(true);
    const prior = await nativeRun(page, overlay);
    expect(prior.audit.engine).toBe("PineTS");
    expect(prior.plots[0].points.filter((point) => typeof point.value === "number").length).toBeGreaterThan(50);
    await expect(editor.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    const current = change === "source" ? overlay.replace("Native editor EMA", "Current source") : overlay;
    if (change === "source") await fillSource(editor, current);
    else if (change === "input") await editor.getByLabel("Length", { exact: true }).fill("7");
    else await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
    await expect.poll(() => page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0);
    await releaseNativeResult(page);
    await page.evaluate(() => { window.__nativeEditorResults = []; });
    await expect(editor.locator("#edge-editor-diagnostics")).not.toContainText("PineTS");
    if (change === "source") await check(editor);
    await run(editor);
    const result = await nativeRun(page, current);
    if (change === "input") expect(result.inputs.in_0).toBe(7);
  });
}

test("an account transition discards an already computed native editor result", async ({ page }) => {
  const state = await fixture(page);
  const editor = await openEditor(page);
  await fillSource(editor, overlay);
  await check(editor);
  await page.evaluate(() => { window.__nativeEditorHoldRun = true; });
  await editor.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__nativeEditorHeldResult))).toBe(true);
  expect((await nativeRun(page, overlay)).audit.engine).toBe("PineTS");
  const scriptsBefore = state.writes.filter((write) => write.key === "custom-indicator-scripts.v1").length;
  state.identity.owner = 7002;
  state.identity.token = "another-owner-token";
  await page.evaluate((key) => {
    const session = JSON.parse(localStorage.getItem(key)!);
    session.user.id = 7002;
    session.token = "another-owner-token";
    localStorage.setItem(key, JSON.stringify(session));
    window.dispatchEvent(new Event("edgelab:auth-session-change"));
  }, AUTH_SESSION_KEY);
  await expect(editor).toBeHidden();
  await expect.poll(() => page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0);
  await releaseNativeResult(page);
  await expect(page.getByRole("region", { name: "Pine strategy results" })).toHaveCount(0);
  expect(state.writes.filter((write) => write.key === "custom-indicator-scripts.v1").length).toBe(scriptsBefore);
});

test("source errors recover and keyboard controls remain reachable without mobile overflow", async ({ page }, info) => {
  await fixture(page);
  const editor = await openEditor(page);
  await fillSource(editor, '//@version=6\nindicator("Broken"\nplot(close)');
  await editor.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(editor.locator("#edge-editor-diagnostics")).toContainText(/failed|error|unexpected|expected|parse/i);
  await fillSource(editor, '//@version=6\nindicator("Runtime error")\nplot(not_a_real_function(close))');
  await check(editor);
  await editor.getByRole("button", { name: "Run", exact: true }).click();
  await expect(editor.locator("#edge-editor-diagnostics")).toContainText(/not_a_real_function|not defined|not a function/i);
  await fillSource(editor, paneSource);
  await check(editor);
  const source = editor.getByLabel("EdgeLab indicator source", { exact: true });
  await source.focus();
  await source.press("Tab");
  await expect(source).not.toBeFocused();
  await expect(editor.locator(":focus")).toHaveCount(1);
  await editor.getByRole("button", { name: "Run", exact: true }).focus();
  await page.keyboard.press("Enter");
  await nativeRun(page, paneSource);
  expect(await editor.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  if (info.project.name === "mobile") {
    for (const control of [source, editor.getByLabel("Length", { exact: true }), editor.getByRole("button", { name: "Save", exact: true })]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(391);
    }
  }
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
});
