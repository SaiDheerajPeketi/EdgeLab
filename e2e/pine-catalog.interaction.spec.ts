import { expect, test, type Locator, type Page } from "@playwright/test";
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
const artifacts = path.resolve(".artifacts/catalog29/browser");
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

test("all 21 hash-verified originals download and 17 legacy scripts require migration", async ({ page }, info) => {
  test.setTimeout(120_000);
  await fixture(page);
  let editor = await openEditor(page), browser = await catalogBrowser(editor);
  expect(catalog.entries).toHaveLength(21);
  await expect(browser.getByRole("combobox", { name: "Script", exact: true }).locator("option")).toHaveCount(21);
  expect(catalog.entries.filter((entry) => entry.pineVersion < 5)).toHaveLength(17);
  for (const [index, entry] of catalog.entries.entries()) {
    // Chrome suppresses repeated downloads from one document. Fresh documents
    // preserve real user downloads while still checking every packaged asset.
    if (index > 0 && index % 7 === 0) {
      await page.reload(); await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
      editor = await openEditor(page); browser = await catalogBrowser(editor);
    }
    await view(browser, entry);
    const source = original(entry);
    expect(Buffer.byteLength(source)).toBe(entry.sourceBytes);
    expect(createHash("sha256").update(source).digest("hex")).toBe(entry.sourceSha256);
    if (entry.pineVersion < 5) {
      await expect(browser.getByText(/needs an explicit migration/)).toBeVisible();
      await expect(browser.getByRole("button", { name: "Import draft", exact: true })).toBeDisabled();
    } else {
      await expect(browser.getByText(/execution is experimental/)).toBeVisible();
      await expect(browser.getByRole("button", { name: "Import draft", exact: true })).toBeEnabled();
    }
    const link = browser.getByRole("link", { name: "Download original", exact: true });
    await expect(link).toHaveAttribute("href", /^blob:/);
    await expect(link).toHaveAttribute("download", entry.path.split("/").at(-1)!);
    await expect(browser.getByRole("link", { name: "Original source", exact: true })).toHaveAttribute("href", entry.originUrl);
    const event = page.waitForEvent("download", { timeout: 10_000 }); await link.click(); const downloaded = await event;
    const bytes = fs.readFileSync((await downloaded.path())!);
    expect(bytes.toString("utf8")).toBe(source); expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sourceSha256);
  }
  const legacy = catalog.entries.filter((entry) => entry.pineVersion < 5).at(-1)!; await view(browser, legacy);
  for (const control of [browser.locator("summary"), browser.getByRole("combobox", { name: "Script", exact: true }), ...await browser.getByRole("button").all(), ...await browser.getByRole("link").all()]) {
    const box = await control.boundingBox(); expect(box).not.toBeNull(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  const summary = browser.locator("summary"); await summary.focus(); await page.keyboard.press("Enter"); await expect(browser).not.toHaveAttribute("open", "");
  await page.keyboard.press("Enter"); await expect(browser).toHaveAttribute("open", ""); await page.keyboard.press("Tab"); await expect(browser.getByRole("combobox", { name: "Script", exact: true })).toBeFocused();
  await browser.getByLabel(`${legacy.name} original source`, { exact: true }).focus(); await expect(browser.locator("pre:focus")).toHaveCount(1);
  await certifyCatalog(page, browser);
  expect(await editor.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  fs.mkdirSync(artifacts, { recursive: true }); await browser.locator("summary").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, `catalog-overview-${info.project.name}.png`) });
  await browser.getByLabel(`${legacy.name} original source`, { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, `legacy-source-${info.project.name}.png`) });
});

test("all four v6 originals import unsaved and require a fresh native Check", async ({ page }, info) => {
  const state = await fixture(page), editor = await openEditor(page), browser = await catalogBrowser(editor);
  const native = catalog.entries.filter((entry) => entry.pineVersion === 6); expect(native).toHaveLength(4);
  for (const entry of native) {
    await view(browser, entry); await browser.getByRole("button", { name: "Import draft", exact: true }).click();
    await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(original(entry));
    await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled(); await expect(editor.getByRole("button", { name: "Add to chart", exact: true })).toBeDisabled();
    await expect(editor.getByRole("region", { name: "Catalog source attribution", exact: true })).toContainText("Unmodified original source");
    await check(editor); await expect(editor.getByRole("button", { name: "Add to chart", exact: true })).toBeEnabled();
    const prepared = await page.evaluate((source) => window.__nativeEditorResults.find((result) => result.status === "completed" && result.result.kind === "prepare" && result.result.source === source), original(entry));
    expect(prepared).toMatchObject({ status: "completed", result: { kind: "prepare", pineVersion: 6, source: original(entry) } });
    expect(scripts(state.storage)).toHaveLength(0);
  }
  fs.mkdirSync(artifacts, { recursive: true }); await editor.locator("#edge-editor-diagnostics").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, `native-draft-${info.project.name}.png`) });
});

test("native import preserves exact source and provenance through save, edits, history, copies and chart snapshots", async ({ page }, info) => {
  const state = await fixture(page), entry = catalog.entries.find((item) => item.name === "Parabolic SAR")!;
  let editor = await openEditor(page), browser = await catalogBrowser(editor);
  await view(browser, entry);
  await browser.getByRole("button", { name: "Import draft", exact: true }).click();
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(original(entry));
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(editor.getByRole("region", { name: "Catalog source attribution", exact: true })).toContainText("Unmodified original source");
  expect(scripts(state.storage)).toHaveLength(0);
  const attribution = editor.getByRole("region", { name: "Catalog source attribution", exact: true });
  await certifyCatalog(page, attribution); await attribution.scrollIntoViewIfNeeded();
  fs.mkdirSync(artifacts, { recursive: true }); await page.screenshot({ path: path.join(artifacts, `catalog-provenance-${info.project.name}.png`) });
  await check(editor);
  await run(editor);
  const native = await nativeRun(page, original(entry));
  expect(native.plots).toHaveLength(7); expect(native.audit.engine).toBe("PineTS"); expect(native.source).toBe(original(entry));
  expect(native.plots.reduce((total, plot) => total + plot.points.filter((point) => typeof point.value === "number").length, 0)).toBeGreaterThan(50);
  fs.mkdirSync(artifacts, { recursive: true }); await editor.locator("#edge-editor-diagnostics").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, `psar-native-run-${info.project.name}.png`) });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => scripts(state.storage).length).toBe(1);
  const first = structuredClone(scripts(state.storage)[0]);
  expect(first).toMatchObject({ source: original(entry), catalogOrigin: provenance(entry), revision: 1 });
  await editor.getByRole("button", { name: "Add to chart", exact: true }).click();
  await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const saveLayout = page.getByRole("button", { name: "Save Layout", exact: true });
  if (!await saveLayout.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await saveLayout.click();
  await expect.poll(() => snapshots(state.storage.get("chart-layout.v1")).filter((item) => item.customScriptId === first.id).length).toBe(1);
  const snapshot = structuredClone(snapshots(state.storage.get("chart-layout.v1")).find((item) => item.customScriptId === first.id)!);
  expect(snapshot).toMatchObject({ customScriptSource: original(entry), customCatalogOrigin: provenance(entry), customScriptVersion: 1 });
  if (await page.getByRole("combobox", { name: "Saved layouts", exact: true }).isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.locator(".chart-stage").first().scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(".chart-stage canvas").evaluateAll((nodes) => nodes.reduce((total, node) => {
    const canvas = node as HTMLCanvasElement, pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return total;
    for (let i = 0; i < pixels.length; i += 4) if ((pixels[i] === 51 && pixels[i + 1] === 136 && pixels[i + 2] === 187) || (pixels[i] === 253 && pixels[i + 1] === 204 && pixels[i + 2] === 2)) total++;
    return total;
  }, 0)), "Actual native PSAR pixels reach the chart canvas").toBeGreaterThan(10);
  await page.screenshot({ path: path.join(artifacts, `psar-chart-context-${info.project.name}.png`) });
  await page.locator(".chart-stage canvas").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(artifacts, `psar-chart-${info.project.name}.png`) });
  await page.reload();
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  editor = await openEditor(page);
  await editor.getByRole("combobox", { name: "Script library", exact: true }).selectOption(first.id);
  await expect(editor.getByRole("region", { name: "Catalog source attribution", exact: true })).toContainText("Unmodified original source");
  const edited = original(entry) + "\n// user review copy";
  await fillSource(editor, edited); await check(editor);
  await expect(editor.getByRole("region", { name: "Catalog source attribution", exact: true })).toContainText("Edited user copy");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => scripts(state.storage).find((item) => item.id === first.id)?.revision).toBe(2);
  expect(scripts(state.storage)[0]).toMatchObject({ source: edited, catalogOrigin: provenance(entry), versions: [{ source: original(entry), catalogOrigin: provenance(entry) }] });
  const frozen = snapshots(state.storage.get("chart-layout.v1")).find((item) => item.customScriptId === first.id)!;
  expect(frozen).toMatchObject({ customScriptSource: snapshot.customScriptSource, customCatalogOrigin: snapshot.customCatalogOrigin, customPinePrepared: snapshot.customPinePrepared, settings: snapshot.settings });
  browser = await catalogBrowser(editor);
  await browser.getByRole("button", { name: "Reload catalog", exact: true }).click();
  await expect(browser.getByRole("status")).toContainText("latest packaged");
  const latestRevision = "1111111111111111111111111111111111111111";
  const latest = { ...catalog, upstreamCommit: latestRevision, lastFetchedAt: "2026-10-07T10:30:00Z", entries: catalog.entries.map((item) => ({ ...item, originUrl: `https://github.com/${catalog.repository}/blob/${latestRevision}/${item.path}` })) };
  let loadedManifest = false;
  await page.route("**/catalog/pine/everget/index.json", (route) => route.fulfill({ json: { schemaVersion: 1, repository: catalog.repository, revisions: [catalog.upstreamCommit, latestRevision] } }));
  await page.route(`**/catalog/pine/everget/${latestRevision}/manifest.json`, (route) => { loadedManifest = true; return route.fulfill({ json: latest }); });
  await page.route(`**/catalog/pine/everget/${latestRevision}/${entry.path}`, (route) => route.fulfill({ body: original(entry), contentType: "text/plain" }));
  const savedBeforeReload = structuredClone(scripts(state.storage));
  const chartBeforeReload = structuredClone(state.storage.get("chart-layout.v1"));
  await browser.getByRole("button", { name: "Reload catalog", exact: true }).click();
  await expect(browser.getByRole("status")).toContainText("New catalog revision loaded"); expect(loadedManifest).toBe(true);
  await browser.getByRole("combobox", { name: "Script", exact: true }).selectOption(entry.id); await browser.getByRole("button", { name: "View source", exact: true }).click();
  await expect(browser.getByLabel(`${entry.name} original source`, { exact: true })).toHaveText(original(entry)); await expect(browser.getByText(/source revision 11111111/)).toBeVisible();
  await expect(browser.getByRole("link", { name: "Original source", exact: true })).toHaveAttribute("href", latest.entries.find((item) => item.id === entry.id)!.originUrl);
  expect(scripts(state.storage)).toEqual(savedBeforeReload); expect(state.storage.get("chart-layout.v1")).toEqual(chartBeforeReload);
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(edited);
  expect(scripts(state.storage)).toHaveLength(1);
  await editor.getByRole("combobox", { name: "Version history", exact: true }).selectOption("1");
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(original(entry));
  await expect(editor.getByRole("region", { name: "Catalog source attribution", exact: true })).toContainText("Unmodified original source");
  await check(editor);
  await editor.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect.poll(() => scripts(state.storage).length).toBe(2);
  const copy = scripts(state.storage).find((item) => item.id !== first.id)!;
  expect(copy.catalogOrigin).toEqual(provenance(entry));
  expect(copy.source).toBe(original(entry));
  await editor.getByRole("combobox", { name: "New script template", exact: true }).selectOption("pine-indicator");
  await expect(editor.getByRole("region", { name: "Catalog source attribution", exact: true })).toHaveCount(0);
  await check(editor);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => scripts(state.storage).length).toBe(3);
  expect(scripts(state.storage).find((item) => item.name === "My Pine EMA")?.catalogOrigin).toBeUndefined();
  expect(await editor.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  fs.mkdirSync(artifacts, { recursive: true });
  await editor.screenshot({ path: path.join(artifacts, `catalog-editor-${info.project.name}.png`) });
});

for (const name of ["SuperTrend", "Chandelier Exit", "HalfTrend"]) {
  test(`${name} executes all nine original output channels with rendering limits disclosed`, async ({ page }) => {
    await fixture(page); const editor = await openEditor(page), browser = await catalogBrowser(editor);
    const entry = catalog.entries.find((item) => item.name === name)!; await view(browser, entry);
    await browser.getByRole("button", { name: "Import draft", exact: true }).click(); await check(editor);
    await run(editor);
    const result = await nativeRun(page, original(entry));
    expect(result.plots).toHaveLength(9);
    expect(result.plots.filter((plot) => plot.style === "fill")).toHaveLength(2);
    expect(result.plots.some((plot) => plot.points.some((point) => typeof point.value === "number"))).toBe(true);
    await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(original(entry));
    await expect(browser.getByText(/execution is experimental/)).toBeVisible();
    expect(result.source).toBe(original(entry));
    await editor.getByRole("button", { name: "Add to chart", exact: true }).click();
    await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
    await expect(page.getByText(/Native fill output is not rendered/).first()).toBeVisible();
  });
}

test("import invalidates a pending genuine native execution before its result publishes", async ({ page }) => {
  await fixture(page);
  const editor = await openEditor(page), browser = await catalogBrowser(editor);
  const entry = catalog.entries.find((item) => item.name === "Parabolic SAR")!;
  await view(browser, entry);
  await fillSource(editor, overlay); await check(editor);
  await page.evaluate(() => { window.__nativeEditorHoldRun = true; });
  await editor.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__nativeEditorHeldResult))).toBe(true);
  expect((await nativeRun(page, overlay)).audit.engine).toBe("PineTS");
  await browser.getByRole("button", { name: "Import draft", exact: true }).click();
  await expect.poll(() => page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0);
  await page.evaluate(() => { window.__nativeEditorHoldRun = false; window.dispatchEvent(window.__nativeEditorHeldResult!); window.__nativeEditorHeldResult = null; });
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(original(entry));
  await expect(editor.locator("#edge-editor-diagnostics")).not.toContainText("PineTS");
});

test("import invalidates an already computed genuine native Check result", async ({ page }) => {
  await fixture(page); const editor = await openEditor(page), browser = await catalogBrowser(editor);
  const entry = catalog.entries.find((item) => item.name === "Parabolic SAR")!; await view(browser, entry); await fillSource(editor, overlay);
  await page.evaluate(() => { window.__nativeEditorHoldPrepare = true; }); await editor.getByRole("button", { name: "Check script", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__nativeEditorHeldResult?.data?.payload?.result?.kind)).toBe("prepare");
  await browser.getByRole("button", { name: "Import draft", exact: true }).click(); await expect.poll(() => page.locator('iframe[sandbox="allow-scripts"]').count()).toBe(0);
  await page.evaluate(() => { window.__nativeEditorHoldPrepare = false; window.dispatchEvent(window.__nativeEditorHeldResult!); window.__nativeEditorHeldResult = null; });
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled(); await expect(editor.getByRole("button", { name: "Add to chart", exact: true })).toBeDisabled();
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(original(entry)); await expect(editor.locator("#edge-editor-diagnostics")).not.toContainText("Checked Pine");
  await check(editor); await expect(editor.locator("#edge-editor-diagnostics")).toContainText("Checked Pine v6");
});

for (const failure of ["hash mismatch", "oversized source", "oversized catalog index"] as const) {
  test(`${failure} blocks unsafe import and recovers without changing the draft`, async ({ page }, info) => {
    await fixture(page); const editor = await openEditor(page), browser = await catalogBrowser(editor);
    const before = await editor.getByLabel("EdgeLab indicator source", { exact: true }).inputValue(); const entry = catalog.entries[0];
    const asset = failure === "oversized catalog index" ? "**/catalog/pine/everget/index.json" : `**/catalog/pine/everget/${catalog.upstreamCommit}/${entry.path}`;
    await page.route(asset, (route) => route.fulfill({ body: failure === "hash mismatch" ? original(entry) + "\n// changed asset" : "x".repeat(failure === "oversized catalog index" ? 32_001 : 20_001), contentType: "text/plain" }));
    await browser.getByRole("button", { name: failure === "oversized catalog index" ? "Reload catalog" : "View source", exact: true }).click();
    await expect(browser.getByRole("alert")).toContainText(failure === "hash mismatch" ? "pinned revision" : "oversized");
    await expect(browser.getByRole("button", { name: "Import draft", exact: true })).toBeDisabled(); await expect(browser.getByRole("link", { name: "Download original", exact: true })).toHaveCount(0);
    await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(before);
    if (failure === "hash mismatch") { fs.mkdirSync(artifacts, { recursive: true }); await browser.getByRole("alert").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(artifacts, `verification-error-${info.project.name}.png`) }); }
    await page.unroute(asset);
    if (failure === "oversized catalog index") { await browser.getByRole("button", { name: "Reload catalog", exact: true }).click(); await expect(browser.getByRole("status")).toContainText("latest packaged"); }
    await view(browser, entry); await expect(browser.getByRole("alert")).toHaveCount(0); await expect(browser.getByRole("button", { name: "Import draft", exact: true })).toBeEnabled();
    await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(before);
  });
}
