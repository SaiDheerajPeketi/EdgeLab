import { selectPineCatalogScript } from "./support/pine-catalog-selection";
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
const artifacts = path.resolve(process.env.EDGELAB_PINE_MIGRATIONS_ARTIFACTS ?? ".artifacts/catalog37/browser");
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
const currentCatalog = JSON.parse(fs.readFileSync(path.resolve("frontend/src/lib/pineCatalogManifestV2.json"), "utf8")) as PineCatalogManifest;
const sourceRoot = path.resolve("frontend/public/catalog/pine/everget", catalog.upstreamCommit);
const original = (entry: typeof catalog.entries[number]) => fs.readFileSync(path.join(sourceRoot, entry.path), "utf8");
const provenance = (entry: typeof catalog.entries[number]) => {
  const current = currentCatalog.entries.find(item => item.id === entry.id)!;
  expect(currentCatalog.upstreamCommit).toBe(catalog.upstreamCommit);
  expect(current).toMatchObject({ path: entry.path, pineVersion: entry.pineVersion, sourceBytes: entry.sourceBytes,
    sourceSha256: entry.sourceSha256, upstreamBlobSha1: entry.upstreamBlobSha1, originUrl: entry.originUrl });
  return { collection: "expanded-v2", catalogId: current.id, repository: currentCatalog.repository, path: current.path,
    upstreamCommit: currentCatalog.upstreamCommit, upstreamBlobSha1: current.upstreamBlobSha1, sourceSha256: current.sourceSha256,
    originalPineVersion: current.pineVersion, author: current.author, license: current.license, originUrl: current.originUrl, lastFetchedAt: currentCatalog.lastFetchedAt };
};
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
  await selectPineCatalogScript(browser, entry.id);
  await browser.getByRole("button", { name: "View source", exact: true }).click();
  await expect(browser.getByLabel(`${entry.name} original source`, { exact: true })).toHaveText(original(entry));
}


const migrationPins = JSON.parse(fs.readFileSync(path.resolve("frontend/src/lib/pineCatalogMigrations.json"), "utf8")).entries as Array<{ id: string; catalogId: string; sourcePath: string; sourceSha256: string }>;
const migrated = (entry: typeof catalog.entries[number]) => fs.readFileSync(path.resolve("frontend/public", "." + migrationPins.find((pin) => pin.catalogId === entry.id)!.sourcePath), "utf8");
const migratedCredit = (entry: typeof catalog.entries[number]) => ({ ...provenance(entry), migration: { id: migrationPins.find((pin) => pin.catalogId === entry.id)!.id, version: 5, sourceSha256: migrationPins.find((pin) => pin.catalogId === entry.id)!.sourceSha256 } });
const legacy = catalog.entries.filter((entry) => entry.pineVersion < 5);
async function importMigration(browser: Locator, entry: typeof catalog.entries[number]) {
  await view(browser, entry);
  await browser.getByRole("button", { name: "Import migrated draft", exact: true }).click();
}
async function capture(page: Page, name: string, project: string) {
  fs.mkdirSync(artifacts, { recursive: true }); await page.screenshot({ path: path.join(artifacts, name + "-" + project + ".png") });
}

test("all17 legacy originals retain separate verified drafts and genuine production Check and Run", async ({ page }, info) => {
  test.setTimeout(120000);
  const state = await fixture(page);
  let editor = await openEditor(page), browser = await catalogBrowser(editor);
  expect(legacy).toHaveLength(17);
  for (const [index, entry] of legacy.entries()) {
    const savedBeforeImport = structuredClone(scripts(state.storage));
    await selectPineCatalogScript(browser, entry.id);
    await expect(browser.getByRole("button", { name: "Import migrated draft", exact: true })).toBeDisabled();
    await view(browser, entry);
    await expect(browser.getByRole("button", { name: "Import draft", exact: true })).toBeDisabled();
    await expect(browser.getByRole("link", { name: "Download original", exact: true })).toHaveAttribute("href", /^blob:/);
    await browser.getByRole("button", { name: "Import migrated draft", exact: true }).click();
    await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(migrated(entry));
    await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(editor.getByRole("button", { name: "Add to chart", exact: true })).toBeDisabled();
    const credit = editor.getByRole("region", { name: "Catalog source attribution", exact: true });
    await expect(credit).toContainText("Unchanged migrated draft");
    await expect(credit).toContainText(entry.sourceSha256.slice(0, 12));
    await expect(credit.getByTitle(entry.sourceSha256, { exact: true })).toBeVisible();
    await expect(credit).toContainText(migratedCredit(entry).migration.sourceSha256.slice(0, 12));
    await expect(credit.getByTitle(migratedCredit(entry).migration.sourceSha256, { exact: true })).toBeVisible();
    await check(editor);
    const prepared = await page.evaluate((source) => window.__nativeEditorResults.find((item) => item.status === "completed" && item.result.kind === "prepare" && item.result.source === source), migrated(entry));
    expect(prepared).toMatchObject({ status: "completed", result: { pineVersion: 5, source: migrated(entry) } });
    await run(editor);
    const actual = await nativeRun(page, migrated(entry));
    expect(actual).toMatchObject({ source: migrated(entry), pineVersion: 5, audit: { engine: "PineTS", engineVersion: "0.11.0" } });
    expect(actual.plots.length).toBeGreaterThan(0);
    expect(actual.inputDefinitions.length).toBeGreaterThan(0);
    expect(Object.keys(actual.inputs)).toHaveLength(actual.inputDefinitions.length);
    expect(actual.plots.some((plot) => plot.points.some((point) => typeof point.value === "number"))).toBe(true);
    expect(scripts(state.storage)).toEqual(savedBeforeImport);
    await editor.getByRole("button", { name: "Add to chart", exact: true }).click();
    await expect.poll(() => scripts(state.storage).length).toBe(index + 1);
    expect(scripts(state.storage).find((script) => script.source === migrated(entry))).toMatchObject({ catalogOrigin: migratedCredit(entry) });
    await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
    if (actual.overlay) {
      const pill = page.locator(".chart-study-pill").filter({ hasText: actual.name }).first();
      await expect(pill).toBeVisible(); await expect(pill).not.toContainText("Error");
    } else {
      const pane = page.getByRole("region", { name: actual.name + " native Pine pane", exact: true });
      await expect(pane).toBeVisible(); await expect(pane.locator("canvas").first()).toBeVisible();
      expect(await pane.locator("canvas").evaluateAll((nodes) => nodes.some((node) => {
        const canvas = node as HTMLCanvasElement, data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let colored = 0;
        for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 60) colored++;
        return colored > 10;
      }))).toBe(true);
    }
    if (entry.path.includes("t3_moving_average") || entry.path.includes("/stochastic.")) {
      if (actual.overlay) await page.locator(".chart-stage").scrollIntoViewIfNeeded();
      else await page.getByRole("region", { name: actual.name + " native Pine pane", exact: true }).scrollIntoViewIfNeeded();
      await capture(page, entry.path.includes("t3_") ? "migrated-t3-chart" : "migrated-stochastic-chart", info.project.name);
    }
    editor = await openEditor(page); browser = await catalogBrowser(editor);
  }
  await view(browser, legacy[0]);
  for (const control of [browser.locator("summary"), browser.getByRole("combobox", { name: "Script", exact: true }), ...await browser.getByRole("button").all(), ...await browser.getByRole("link").all()]) {
    const box = await control.boundingBox(); expect(box).not.toBeNull(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await browser.getByRole("button", { name: "Import migrated draft", exact: true }).focus();
  await expect(browser.getByRole("button", { name: "Import migrated draft", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(migrated(legacy[0]));
  await certifyCatalog(page, browser); await certifyCatalog(page, editor.getByRole("region", { name: "Catalog source attribution" }));
  expect(await editor.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await browser.getByRole("button", { name: "Import migrated draft", exact: true }).scrollIntoViewIfNeeded(); await capture(page, "migration-catalog", info.project.name);
  await editor.getByRole("region", { name: "Catalog source attribution" }).scrollIntoViewIfNeeded(); await capture(page, "migration-provenance", info.project.name);
});

test("migrated Hull genuine Run save reload edit history duplicate and chart preserve both source bases", async ({ page }, info) => {
  const state = await fixture(page), entry = legacy.find((item) => item.path.includes("hull_moving"))!;
  let editor = await openEditor(page), browser = await catalogBrowser(editor);
  await importMigration(browser, entry); await check(editor); await editor.getByLabel("Length", { exact: true }).fill("9"); await run(editor);
  const native = await nativeRun(page, migrated(entry));
  expect(native).toMatchObject({ source: migrated(entry), pineVersion: 5, audit: { engine: "PineTS" } });
  expect(native.inputs.in_0).toBe(9);
  expect(native.plots.find((plot) => plot.name === "HMA")!.points.filter((point) => typeof point.value === "number").length).toBeGreaterThan(50);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => scripts(state.storage).length).toBe(1);
  const first = structuredClone(scripts(state.storage)[0]); expect(first).toMatchObject({ source: migrated(entry), catalogOrigin: migratedCredit(entry), revision: 1 });
  await editor.getByRole("button", { name: "Add to chart", exact: true }).click();
  await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const saveLayout = page.getByRole("button", { name: "Workspace", exact: true });
  if (!await saveLayout.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await saveLayout.click();
  const workspace = page.getByRole("dialog", { name: "Workspace controls", exact: true });
  await workspace.getByPlaceholder("Layout name", { exact: true }).fill("Migrated catalog chart");
  await workspace.getByRole("button", { name: "Save", exact: true }).click(); await page.keyboard.press("Escape");
  await expect.poll(() => snapshots(state.storage.get("chart-layout.v1")).filter((item) => item.customScriptId === first.id).length).toBe(1);
  const snapshot = structuredClone(snapshots(state.storage.get("chart-layout.v1")).find((item) => item.customScriptId === first.id)!);
  expect(snapshot).toMatchObject({ customScriptSource: migrated(entry), customCatalogOrigin: migratedCredit(entry) });
  await expect.poll(() => page.locator(".chart-stage canvas").evaluateAll((nodes) => nodes.reduce((total, node) => {
    const c = node as HTMLCanvasElement, pixels = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data;
    if (pixels) for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 109 && pixels[i + 1] === 30 && pixels[i + 2] === 127) total++;
    return total;
  }, 0)), "Genuine migrated HMA purple line reaches actual chart Canvas").toBeGreaterThan(10);
  await page.locator(".chart-stage").scrollIntoViewIfNeeded(); await capture(page, "migrated-hull-chart", info.project.name);
  await page.reload(); editor = await openEditor(page);
  await editor.getByRole("combobox", { name: "Script library", exact: true }).selectOption(first.id);
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(migrated(entry));
  const edited = migrated(entry) + "\n// user review";
  await fillSource(editor, edited); await check(editor);
  await expect(editor.getByRole("region", { name: "Catalog source attribution" })).toContainText("Edited from migrated base");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => scripts(state.storage)[0]?.revision).toBe(2);
  expect(scripts(state.storage)[0]).toMatchObject({ source: edited, catalogOrigin: migratedCredit(entry), versions: [{ source: migrated(entry), catalogOrigin: migratedCredit(entry) }] });
  expect(snapshots(state.storage.get("chart-layout.v1")).find((item) => item.customScriptId === first.id)).toEqual(snapshot);
  await editor.getByRole("combobox", { name: "Version history", exact: true }).selectOption("1");
  await expect(editor.getByRole("region", { name: "Catalog source attribution" })).toContainText("Unchanged migrated draft");
  await check(editor); await editor.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect.poll(() => scripts(state.storage).length).toBe(2);
  expect(scripts(state.storage).find((item) => item.id !== first.id)).toMatchObject({ source: migrated(entry), catalogOrigin: migratedCredit(entry) });
  await editor.getByRole("region", { name: "Catalog source attribution" }).scrollIntoViewIfNeeded(); await capture(page, "migrated-hull-saved", info.project.name);
});

for (const invalidation of ["edit", "close", "selection", "reload"] as const) {
  test("a delayed migration cannot replace a draft after " + invalidation, async ({ page }) => {
    await fixture(page);
    let editor = await openEditor(page), browser = await catalogBrowser(editor);
    const entry = legacy[0], before = await editor.getByLabel("EdgeLab indicator source", { exact: true }).inputValue();
    await view(browser, entry);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
    let completed = false;
    await page.route("**" + migrationPins.find((pin) => pin.catalogId === entry.id)!.sourcePath, async (route) => {
      entered(); await gate;
      await route.fulfill({ body: migrated(entry), contentType: "text/plain" }); completed = true;
    });
    await browser.getByRole("button", { name: "Import migrated draft", exact: true }).click(); await started;
    await expect(browser.getByRole("combobox", { name: "Script", exact: true })).toBeDisabled();
    await expect(browser.getByRole("button", { name: "Reload catalog", exact: true })).toBeDisabled();
    const changed = before + "\n// changed while migration loads";
    if (invalidation === "edit") await fillSource(editor, changed);
    else if (invalidation === "reload") {
      await page.reload(); editor = await openEditor(page); browser = await catalogBrowser(editor);
    } else {
      await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
      editor = await openEditor(page); browser = await catalogBrowser(editor);
      if (invalidation === "selection") await selectPineCatalogScript(browser, legacy[1].id);
    }
    release(); await expect.poll(() => completed).toBe(true);
    await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(invalidation === "edit" ? changed : before);
    await expect(editor.getByRole("region", { name: "Catalog source attribution" })).toHaveCount(0);
  });
}
test("tampered derivative fails closed and a clean retry preserves verified original download", async ({ page }, info) => {
  const state = await fixture(page), editor = await openEditor(page), browser = await catalogBrowser(editor), entry = legacy[0];
  const before = await editor.getByLabel("EdgeLab indicator source", { exact: true }).inputValue();
  await view(browser, entry);
  const pattern = "**" + migrationPins.find((pin) => pin.catalogId === entry.id)!.sourcePath;
  await page.route(pattern, (route) => route.fulfill({ body: migrated(entry).replace("HMA", "BAD"), contentType: "text/plain" }));
  await browser.getByRole("button", { name: "Import migrated draft", exact: true }).click();
  await expect(browser.getByRole("alert")).toHaveText("Pine source does not match its pinned revision, licence or version.");
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(before);
  expect(scripts(state.storage)).toHaveLength(0);
  await browser.getByRole("alert").scrollIntoViewIfNeeded(); await capture(page, "migration-integrity-error", info.project.name);
  await page.unroute(pattern); await browser.getByRole("button", { name: "Import migrated draft", exact: true }).click();
  await expect(editor.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(migrated(entry));
  const event = page.waitForEvent("download"); await browser.getByRole("link", { name: "Download original", exact: true }).click();
  const bytes = fs.readFileSync((await (await event).path())!); expect(bytes.toString("utf8")).toBe(original(entry));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sourceSha256);
});
