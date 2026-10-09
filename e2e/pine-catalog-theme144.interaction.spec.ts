import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { productSetup, editor, checkedRun } from "./pine-layering.product-support";
import { selectPineCatalogScript, expectPineCatalogOptionCount } from "./support/pine-catalog-selection";
const catalog = JSON.parse(fs.readFileSync("frontend/src/lib/pineCatalogManifestV2.json", "utf8")) as { upstreamCommit: string; entries: Array<{ id: string; name: string; path: string; pineVersion: number; sourceSha256: string }> };

const baseline = process.env.EDGELAB_CATALOG_THEME144_BASELINE === "1";
const artifacts = path.resolve(".artifacts/pine-catalog-theme144", baseline ? "baseline" : "final");
const entry = catalog.entries.find(item => item.name === "Parabolic SAR")!;
const legacy = catalog.entries.find(item => item.pineVersion < 5)!;
const sourcePath = `/catalog/pine/everget-v2/${catalog.upstreamCommit}/${entry.path}`;
const original = fs.readFileSync(path.join("frontend/public", sourcePath), "utf8");
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function seal() {
  const entries: string[] = [];
  const visit = (directory: string) => { for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) visit(full); else entries.push(path.relative("frontend/dist", full) + ":" + hash(fs.readFileSync(full)));
  } };
  visit("frontend/dist"); return { files: entries.length, sha256: hash(entries.sort().join("\n")) };
}
const beforeSeal = seal();
const applicationErrors = new WeakMap<Page, string[]>();
const harnessErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  applicationErrors.set(page, []);
  harnessErrors.set(page, []);
  page.on("pageerror", error => {
    if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") harnessErrors.get(page)!.push(error.message);
    else applicationErrors.get(page)!.push(error.message);
  });
});
test.afterEach(({ page }) => { expect(applicationErrors.get(page)).toEqual([]); expect(seal()).toEqual(beforeSeal); });
async function browserIn(dialog: Locator) {
  const browser = dialog.locator("details").filter({ hasText: "Community Pine catalog" });
  await browser.locator("summary").click(); return browser;
}
async function choose(browser: Locator, selected: typeof entry) {
  if (baseline) await browser.getByRole("combobox", { name: "Script", exact: true }).selectOption(selected.id);
  else await selectPineCatalogScript(browser, selected.id);
}
const palettes = {
  light: { "--ui-surface": "#ded1bf", "--ui-floating": "#f1e9dc", "--ui-inset": "#e0d5c5", "--ui-raised": "#d4c7b5",
    "--ui-hover": "#c1b39e", "--ui-selection": "#b6cce0", "--ui-border-subtle": "#887766", "--ui-border-strong": "#665544",
    "--ui-focus": "#704099", "--text-primary": "#18293a", "--text-secondary": "#405162", "--text-muted": "#526374",
    "--text-accent": "#493060", "--warning-text": "#704510", "--loss-text": "#8c2034" },
  dark: { "--ui-surface": "#192532", "--ui-floating": "#223243", "--ui-inset": "#101922", "--ui-raised": "#283b4e",
    "--ui-hover": "#344b62", "--ui-selection": "#334c65", "--ui-border-subtle": "#718294", "--ui-border-strong": "#8e9faf",
    "--ui-focus": "#9cdcff", "--text-primary": "#edf4fa", "--text-secondary": "#ccd9e5", "--text-muted": "#a9bbcd",
    "--text-accent": "#a7dfff", "--warning-text": "#ffcf88", "--loss-text": "#ffb0c1" },
};
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
async function geometry(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  return target.evaluate((element: HTMLElement) => {
    const r = element.getBoundingClientRect(), s = getComputedStyle(element), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { background: s.backgroundColor, color: s.color, border: s.borderTopColor, outline: s.outlineColor,
      width: r.width, height: r.height, x: r.x, y: r.y, right: r.right, bottom: r.bottom,
      viewport: { width: innerWidth, height: innerHeight }, reachable: hit === element || !!hit && element.contains(hit) };
  });
}
async function capture(page: Page, info: TestInfo, name: string, evidence: unknown, workerReceipts: unknown[] = []) {
  const folder = path.join(artifacts, info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify({ scope: "Actual production editor/catalog/native runtime; light/dark semantic palette inheritance, not an app theme chooser. Only auth, API storage and specified HTTP/provider seams controlled.", beforeSeal, afterSeal: seal(), evidence, workerReceipts, applicationErrors: applicationErrors.get(page), opaquePlaywrightHarnessErrors: harnessErrors.get(page) }, null, 2));
  await page.screenshot({ path: path.join(folder, name + ".png") });
}

test("source catalog portal and exact import lifecycle respect light/dark semantic palettes", async ({ page }, info) => {
  const state = await productSetup(page), dialog = await editor(page), browser = await browserIn(dialog), evidence: any[] = [];
  for (const [name, palette] of Object.entries(palettes)) {
    await page.evaluate(values => { for (const [key, value] of Object.entries(values)) document.body.style.setProperty(key, value); }, palette);
    await choose(browser, legacy);
    const shell = await geometry(browser), warning = await geometry(browser.getByText(/needs an explicit migration/)), summary = await geometry(browser.locator("summary"));
    evidence.push({ name, shell, warning, summary });
    if (!baseline) {
      expect(shell.background).toBe(rgb(palette["--ui-surface"])); expect(shell.color).toBe(rgb(palette["--text-secondary"]));
      expect(shell.border).toBe(rgb(palette["--ui-border-subtle"])); expect(summary.color).toBe(rgb(palette["--text-primary"]));
      expect(warning.color).toBe(rgb(palette["--warning-text"]));
      const trigger = browser.getByRole("combobox", { name: "Script", exact: true });
      await expectPineCatalogOptionCount(browser, 29); await trigger.focus(); await trigger.press("ArrowDown");
      const menu = page.getByRole("listbox", { name: "Script", exact: true }); await expect(menu).toBeVisible();
      const menuGeometry = await geometry(menu); evidence.push({ name, menuGeometry });
      expect(menuGeometry.background).toBe(rgb(palette["--ui-floating"])); expect(menuGeometry.x).toBeGreaterThanOrEqual(0);
      expect(menuGeometry.right).toBeLessThanOrEqual(menuGeometry.viewport.width + 1); expect(menuGeometry.bottom).toBeLessThanOrEqual(menuGeometry.viewport.height + 1);
      await trigger.press("Escape"); await expect(menu).toBeHidden(); await expect(trigger).toBeFocused(); await expect(dialog).toBeVisible();
      const triggerGeometry = await geometry(trigger); expect(triggerGeometry.height).toBeGreaterThanOrEqual(44); expect(triggerGeometry.reachable).toBe(true);
    }
    await choose(browser, entry); await browser.getByRole("button", { name: "View source", exact: true }).click();
    const pre = browser.getByLabel(`${entry.name} original source`, { exact: true }); await expect(pre).toHaveText(original);
    if (!baseline) {
      const download = browser.getByRole("link", { name: "Download original", exact: true });
      const verifiedUrl = await download.getAttribute("href"); expect(verifiedUrl).toMatch(/^blob:/);
      await selectPineCatalogScript(browser, entry.id);
      await expect(pre).toHaveText(original); await expect(download).toHaveAttribute("href", verifiedUrl!);
      await expect(browser.getByRole("button", { name: "Import draft", exact: true })).toBeEnabled();
      await selectPineCatalogScript(browser, legacy.id);
      await expect(pre).toHaveCount(0); await expect(download).toHaveCount(0);
      await expect(browser.getByRole("button", { name: "Import draft", exact: true })).toBeDisabled();
      await selectPineCatalogScript(browser, entry.id); await browser.getByRole("button", { name: "View source", exact: true }).click();
      await expect(pre).toHaveText(original);
    }
    const text = await geometry(pre), link = await geometry(browser.getByRole("link", { name: "Original source", exact: true }));
    evidence.push({ name, text, link });
    if (!baseline) { expect(text.background).toBe(rgb(palette["--ui-inset"])); expect(text.color).toBe(rgb(palette["--text-primary"])); expect(link.color).toBe(rgb(palette["--text-accent"])); }
    await capture(page, info, "palette-" + name, evidence);
  }
  if (baseline) { expect(evidence.some(item => item.shell && item.shell.background !== rgb(palettes[item.name as "light" | "dark"]["--ui-surface"])) ).toBe(true); return; }
  const downloaded = page.waitForEvent("download"); await browser.getByRole("link", { name: "Download original", exact: true }).click();
  const bytes = fs.readFileSync((await (await downloaded).path())!); expect(bytes.toString("utf8")).toBe(original); expect(hash(bytes)).toBe(entry.sourceSha256);
  await browser.getByRole("button", { name: "Import draft", exact: true }).click();
  const field = dialog.getByLabel("EdgeLab indicator source", { exact: true }); await expect(field).toHaveValue(original);
  await checkedRun(dialog);
  const native = await page.evaluate(source => [...(window as any).__layerResults].reverse().find(item => item.status === "completed" && item.result?.kind === "run" && item.result.source === source), original);
  expect(native.result.audit.engine).toBe("PineTS"); expect(native.result.plots.length).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((item: any) => item.source === original && item.catalogOrigin?.sourceSha256 === entry.sourceSha256)).toBe(true);
  const draft = original + "\n// Personal draft144"; await field.fill(draft);
  await browser.getByRole("button", { name: "Reload catalog", exact: true }).click();
  await expect(browser.getByRole("status")).toHaveText("Showing the selected packaged catalog revision."); await expect(field).toHaveValue(draft);
  await page.route("**" + sourcePath, route => route.fulfill({ status: 503, body: "Source unavailable" }));
  await browser.getByRole("button", { name: "View source", exact: true }).click();
  await expect(browser.getByRole("alert")).toBeVisible(); expect((await geometry(browser.getByRole("alert"))).color).toBe(rgb(palettes.dark["--loss-text"]));
  await expect(browser.getByRole("button", { name: "Import draft", exact: true })).toBeDisabled(); await expect(browser.getByRole("link", { name: "Download original", exact: true })).toHaveCount(0); await expect(field).toHaveValue(draft);
  await page.unroute("**" + sourcePath); await browser.getByRole("button", { name: "View source", exact: true }).click();
  await expect(browser.getByLabel(`${entry.name} original source`, { exact: true })).toHaveText(original); await expect(field).toHaveValue(draft);
  const workerName = fs.readdirSync("frontend/dist/assets").find(name => /^pine-native-worker.*\.js$/.test(name))!;
  const worker = fs.readFileSync(path.join("frontend/dist/assets", workerName)); expect(state.workerReceipts.length).toBeGreaterThan(0);
  for (const receipt of state.workerReceipts) expect(receipt).toMatchObject({ bytes: worker.length, sha256: hash(worker) });
  await capture(page, info, "source-lifecycle", { evidence, sourceSha256: hash(original), nativeAudit: native.result.audit, saved: state.storage.get("custom-indicator-scripts.v1") }, state.workerReceipts);
});

test("live candles preserve pending source fetch but draft edits invalidate it", async ({ page }, info) => {
  test.skip(baseline, "Baseline records the existing semantic palette mismatch only.");
  const origin = Date.parse("2026-09-15T08:30:00Z") / 1000, sockets: any[] = [];
  const history = Array.from({ length: 120 }, (_, i) => [ (origin + i * 60) * 1000, "67500", "67530", "67490", String(67500 + i / 10), "10", (origin + i * 60) * 1000 + 59999 ]);
  await page.routeWebSocket(/data-stream\.binance\.vision/, socket => { sockets.push(socket); });
  const state = await productSetup(page, { target: "/app/live", keepBinanceWebSocket: true, beforeNavigate: async () => {
    await page.route("**/api/live/binance/instruments?**", route => route.fulfill({ json: { provider: "binance", instruments: [{ symbol: "BTCUSDT", name: "BTCUSDT", status: "TRADING", asset_class: "crypto", base_asset: "BTC", quote_asset: "USDT", tick_size: .01, min_quantity: .00001, quantity_step: .00001 }], total: 1 } }));
    await page.route("https://data-api.binance.vision/**", route => {
      const url = new URL(route.request().url());
      return route.fulfill({ json: url.pathname.endsWith("/klines") ? url.searchParams.has("endTime") ? [] : history : url.pathname.endsWith("/ticker/24hr") ? [{ symbol: "BTCUSDT", lastPrice: "67511.9", priceChange: "1", priceChangePercent: ".1", highPrice: "67600", lowPrice: "67400", volume: "1000", quoteVolume: "67500000", openPrice: "67500", closeTime: Date.parse("2026-09-15T10:30:00Z") }] : { symbols: [{ symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" }] } });
    });
  } });
  await expect.poll(() => sockets.some(socket => socket.url().includes("btcusdt@kline_1m"))).toBe(true);
  const liveSource = '//@version=6\nindicator("Catalog live144",overlay=true)\nplot(close,"Price")';
  let dialog = await editor(page); const field = dialog.getByLabel("EdgeLab indicator source", { exact: true }); await field.fill(liveSource);
  await dialog.getByRole("button", { name: "Check script", exact: true }).click(); await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save", exact: true }).click(); await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click(); dialog = await editor(page);
  const browser = await browserIn(dialog); await selectPineCatalogScript(browser, entry.id);
  let release!: () => void, fetched = false;
  await page.route("**" + sourcePath, async route => { fetched = true; await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ status: 200, body: original, contentType: "text/plain" }); });
  await browser.getByRole("button", { name: "View source", exact: true }).click(); await expect.poll(() => fetched).toBe(true);
  const event = { stream: "btcusdt@kline_1m", data: { e: "kline", E: Date.parse("2026-09-15T10:30:01Z"), s: "BTCUSDT", k: { t: (origin + 120 * 60) * 1000, T: (origin + 121 * 60) * 1000 - 1, i: "1m", s: "BTCUSDT", o: "67512", h: "67530", l: "67500", c: "67520", v: "15", x: false } } };
  for (const socket of sockets) if (socket.url().includes("btcusdt@kline_1m")) socket.send(JSON.stringify(event));
  await expect.poll(() => page.evaluate(source => (window as any).__layerResults.some((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    if (response?.status !== "completed" || response.result?.source !== source || !payload.sessionId) return false;
    const plot = response.result.plots[0]; return plot.packed ? new Float64Array(response.buffers[plot.packed.values]).at(-1) === 67520 : plot.points.at(-1)?.value === 67520;
  }), liveSource)).toBe(true);
  await expect(browser.getByRole("combobox", { name: "Script", exact: true })).toBeDisabled(); release();
  await expect(browser.getByLabel(`${entry.name} original source`, { exact: true })).toHaveText(original);
  fetched = false; await browser.getByRole("button", { name: "View source", exact: true }).click(); await expect.poll(() => fetched).toBe(true);
  const draft = liveSource + "\n// edited while source loads"; await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(draft); release();
  await expect(browser.getByRole("combobox", { name: "Script", exact: true })).toBeEnabled();
  await expect(browser.getByLabel(`${entry.name} original source`, { exact: true })).toHaveCount(0); await expect(dialog.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(draft);
  await capture(page, info, "live-source-ownership", { providerEvent: event, heldSourceSurvivedRealNativeTick: true, editedDraft: draft, sourceSha256: hash(original) }, state.workerReceipts);
});
