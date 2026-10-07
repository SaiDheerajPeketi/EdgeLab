import { test, expect, type Page, type Locator } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { productSetup, editor, checkedRun } from "./pine-layering.product-support";

type Entry = { id: string; name: string; path: string; pineVersion: number; sourceSha256: string; upstreamBlobSha1: string; author: string; license: string; originUrl: string };
const catalog = JSON.parse(fs.readFileSync("frontend/src/lib/pineCatalogManifestV2.json", "utf8"));
const legacy = JSON.parse(fs.readFileSync("frontend/src/lib/pineCatalogManifest.json", "utf8"));
const pins = JSON.parse(fs.readFileSync("frontend/src/lib/pineCatalogMigrations.json", "utf8")).entries;
const added: Entry[] = catalog.entries.filter((entry: Entry) => !legacy.entries.some((old: Entry) => old.id === entry.id));
const artifacts = path.resolve(".artifacts/pine-catalog62/browser");
const pinFor = (entry: Entry) => pins.find((pin: any) => pin.catalogId === entry.id);
const migrated = (entry: Entry) => fs.readFileSync(path.join("frontend/public", pinFor(entry).sourcePath), "utf8");
const original = (entry: Entry) => fs.readFileSync(`frontend/public/catalog/pine/everget-v2/${catalog.upstreamCommit}/${entry.path}`, "utf8");
const credit = (entry: Entry) => ({
  catalogId: entry.id,
  repository: catalog.repository,
  collection: "expanded-v2",
  path: entry.path,
  upstreamCommit: catalog.upstreamCommit,
  upstreamBlobSha1: entry.upstreamBlobSha1,
  sourceSha256: entry.sourceSha256,
  originalPineVersion: entry.pineVersion,
  author: entry.author,
  license: entry.license,
  originUrl: entry.originUrl,
  lastFetchedAt: catalog.lastFetchedAt,
  migration: { id: pinFor(entry).id, version: 5, sourceSha256: pinFor(entry).sourceSha256 },
});
async function browserIn(dialog: Locator) {
  const browser = dialog.locator("details").filter({ hasText: "Community Pine catalog" });
  if (!await browser.evaluate((element) => (element as HTMLDetailsElement).open)) await browser.locator("summary").click();
  await expect(browser.getByRole("combobox", { name: "Script", exact: true }).locator("option")).toHaveCount(29);
  return browser;
}
async function view(browser: Locator, entry: Entry) {
  await browser.getByRole("combobox", { name: "Script", exact: true }).selectOption(entry.id);
  await browser.getByRole("button", { name: "View source", exact: true }).click();
  await expect(browser.getByLabel(`${entry.name} original source`, { exact: true })).toHaveText(original(entry));
  await expect(browser.getByRole("link", { name: "Full licence", exact: true })).toHaveAttribute("href", `/catalog/pine/everget-v2/${catalog.upstreamCommit}/LICENSE.txt`);
}
async function freshRun(page: Page, source: string, after: number) {
  const lookup = ({ source, after }: { source: string; after: number }) => (window as any).__layerResults.slice(after).filter((response: any) =>
    response.status === "completed" && response.result.kind === "run" && response.result.source === source).at(-1)?.result;
  await expect.poll(() => page.evaluate(lookup, { source, after })).toBeTruthy();
  const result = await page.evaluate(lookup, { source, after });
  expect(result.source).toBe(source);
  expect(result.pineVersion).toBe(5);
  expect(result.audit).toMatchObject({ engine: "PineTS", engineVersion: "0.11.0", mode: "historical" });
  expect(result.plots.some((plot: any) => plot.points.filter((point: any) => typeof point.value === "number").length > 50)).toBe(true);
  for (const plot of result.plots) expect(new Set(plot.points.map((point: any) => point.time)).size).toBe(plot.points.length);
  return result;
}
async function colors(pane: Locator) {
  return pane.locator("canvas").evaluateAll((nodes) => nodes.map((node) => {
    const canvas = node as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let index = 0; index < data.length; index += 4) if (Math.max(data[index], data[index + 1], data[index + 2]) - Math.min(data[index], data[index + 1], data[index + 2]) > 60) colored++;
    return { width: canvas.width, height: canvas.height, colored };
  }));
}
function workerBinding(receipts: any[]) {
  const workerName = fs.readdirSync("frontend/dist/assets").find((name) => /^pine-native-worker.*\.js$/.test(name))!;
  const bytes = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  expect(receipts.length).toBeGreaterThan(0);
  for (const receipt of receipts) expect(receipt).toMatchObject({ bytes: bytes.length, sha256 });
  return { workerName, bytes: bytes.length, sha256, receipts };
}
async function capture(page: Page, folder: string, name: string, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(folder, `${name}.png`) });
}

// Only identity, billing, storage and replay-provider HTTP boundaries are fixtures.
// The unchanged opaque sandbox and actual production worker perform every Check/Run.
test("all eight expanded originals import as pinned v5 copies, run, save and render; saved copy reruns after reload", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const setup = await productSetup(page);
  const folder = path.join(artifacts, info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  expect(added).toHaveLength(8);
  const runs: any[] = [];
  let lastSaved: any;
  for (const entry of added) {
    const dialog = await editor(page);
    const browser = await browserIn(dialog);
    const savedBefore = structuredClone(setup.storage.get("custom-indicator-scripts.v1") ?? []);
    await view(browser, entry);
    await expect(browser.getByRole("button", { name: "Import draft", exact: true })).toBeDisabled();
    await browser.getByRole("button", { name: "Import migrated draft", exact: true }).click();
    await expect(dialog.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(migrated(entry));
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    const attribution = dialog.getByRole("region", { name: "Catalog source attribution", exact: true });
    await expect(attribution).toContainText("Unchanged migrated draft");
    await expect(attribution.getByTitle(entry.sourceSha256, { exact: true })).toBeVisible();
    await expect(attribution.getByTitle(pinFor(entry).sourceSha256, { exact: true })).toBeVisible();
    expect(setup.storage.get("custom-indicator-scripts.v1") ?? []).toEqual(savedBefore);
    const after = await page.evaluate(() => (window as any).__layerResults.length);
    await checkedRun(dialog);
    const result = await freshRun(page, migrated(entry), after);
    if (entry.path.startsWith("research/")) expect(result.inputDefinitions).toHaveLength(0);
    else expect(result.inputDefinitions.length).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => setup.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === migrated(entry))).toBe(true);
    const saved = structuredClone(setup.storage.get("custom-indicator-scripts.v1").find((script: any) => script.source === migrated(entry)));
    expect(saved.catalogOrigin).toEqual(credit(entry));
    await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
    await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
    const pane = page.getByRole("region", { name: `${result.name} native Pine pane`, exact: true });
    await expect(pane).toBeVisible();
    await expect.poll(async () => (await colors(pane)).some((canvas) => canvas.colored > 10)).toBe(true);
    const pixels = await colors(pane);
    if (entry.path.includes("tsi_true") || entry.path.includes("ulcer_index")) await capture(page, folder, path.basename(entry.path, ".pine") + "-installed", pane);
    runs.push({ entry, source: migrated(entry), result, saved, pixels });
    const chip = page.locator(".native-study-chip").filter({ hasText: saved.name }).first();
    await chip.getByRole("button", { name: `Remove ${saved.name}`, exact: true }).click();
    await expect(pane).toBeHidden();
    lastSaved = saved;
  }
  expect(setup.storage.get("custom-indicator-scripts.v1")).toHaveLength(8);
  await page.reload();
  const dialog = await editor(page);
  await dialog.getByLabel("Script library", { exact: true }).selectOption(lastSaved.id);
  await expect(dialog.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(lastSaved.source);
  const after = await page.evaluate(() => (window as any).__layerResults.length);
  await checkedRun(dialog);
  const reloaded = await freshRun(page, lastSaved.source, after);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const chip = page.locator(".native-study-chip").filter({ hasText: lastSaved.name }).first();
  await chip.getByRole("button", { name: `Inputs for ${lastSaved.name}`, exact: true }).click();
  const beforeInput = await page.evaluate(() => (window as any).__layerResults.length);
  await chip.getByRole("spinbutton", { name: "Length", exact: true }).fill("8");
  const custom = await freshRun(page, lastSaved.source, beforeInput);
  expect(custom.inputs.in_0).toBe(8);
  expect(custom.plots.find((plot: any) => plot.name === "Ulcer").points.map((point: any) => point.value)).not.toEqual(reloaded.plots.find((plot: any) => plot.name === "Ulcer").points.map((point: any) => point.value));
  expect(setup.storage.get("custom-indicator-scripts.v1").find((script: any) => script.id === lastSaved.id)).toEqual(lastSaved);
  const pane = page.getByRole("region", { name: `${custom.name} native Pine pane`, exact: true });
  await expect.poll(async () => (await colors(pane)).some((canvas) => canvas.colored > 10)).toBe(true);
  await capture(page, folder, "saved-ulcer-input-rerun", pane);
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(folder, "imports-save-reload.json"), JSON.stringify({ runs, lastSaved, reloaded, custom, worker: workerBinding(setup.workerReceipts), operations: [...setup.receipts.values()], errors }, null, 2));
});

test("tampered migration and incomplete refetch fail without mutating the draft; authentic retry retains full credit", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const setup = await productSetup(page);
  const dialog = await editor(page);
  const browser = await browserIn(dialog);
  const entry = added.find((item) => item.path.includes("ulcer_index"))!;
  const sourceInput = dialog.getByLabel("EdgeLab indicator source", { exact: true });
  const before = await sourceInput.inputValue();
  await view(browser, entry);
  const derivativeUrl = `**${pinFor(entry).sourcePath}`;
  await page.route(derivativeUrl, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: migrated(entry) + "\n// altered packaged bytes" }));
  await browser.getByRole("button", { name: "Import migrated draft", exact: true }).click();
  await expect(browser.getByRole("alert")).toContainText(/pinned|verified|match/i);
  await expect(sourceInput).toHaveValue(before);
  await expect(dialog.getByRole("region", { name: "Catalog source attribution", exact: true })).toBeHidden();
  expect(setup.storage.get("custom-indicator-scripts.v1") ?? []).toEqual([]);
  await page.unroute(derivativeUrl);
  await browser.getByRole("button", { name: "Import migrated draft", exact: true }).click();
  await expect(sourceInput).toHaveValue(migrated(entry));
  const attribution = dialog.getByRole("region", { name: "Catalog source attribution", exact: true });
  await expect(attribution.getByTitle(entry.sourceSha256, { exact: true })).toBeVisible();
  await expect(attribution.getByTitle(pinFor(entry).sourceSha256, { exact: true })).toBeVisible();
  const forgedManifestUrl = `**/catalog/pine/everget-v2/${catalog.upstreamCommit}/manifest.json`;
  await page.route(forgedManifestUrl, (route) => route.fulfill({ json: { ...catalog, entries: catalog.entries.slice(1) } }));
  await browser.getByRole("button", { name: "Reload catalog", exact: true }).click();
  await expect(browser.getByRole("alert")).toContainText(/catalog|collection/i);
  await expect(sourceInput).toHaveValue(migrated(entry));
  await expect(browser.getByRole("combobox", { name: "Script", exact: true }).locator("option")).toHaveCount(29);
  await page.unroute(forgedManifestUrl);
  await browser.getByRole("button", { name: "Reload catalog", exact: true }).click();
  await expect(browser.getByRole("alert")).toBeHidden();
  await expect(browser.getByRole("status")).toContainText("latest packaged");
  await expect(sourceInput).toHaveValue(migrated(entry));
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  const folder = path.join(artifacts, info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  await capture(page, folder, "verified-source-credit", attribution);
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(folder, "tamper-and-refetch.json"), JSON.stringify({ entry, pin: pinFor(entry), original: original(entry), migrated: migrated(entry), saved: setup.storage.get("custom-indicator-scripts.v1") ?? [], errors }, null, 2));
});
