import { test as base, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.EDGELAB_CHART109_PORT ?? 45309);
type Harness = { origin: string };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const bundle = await build({ entryPoints: [path.join(root, "e2e/chart-palette109.fixture.tsx")], bundle: true,
      write: false, format: "iife", jsx: "automatic", define: { "import.meta.env": "{}" } });
    const assets = path.join(root, "frontend/dist/assets");
    const css = fs.readdirSync(assets).filter(name => name.endsWith(".css")).map(name => fs.readFileSync(path.join(assets, name))).join("\n");
    const server = http.createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
      else if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
      else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body style="background:var(--ui-canvas);margin:0"><div id="root"></div><script src="/fixture.js"></script>'); }
    });
    await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:" + port }); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }, { scope: "worker" }],
  harness: async ({ serverHarness }, use) => use(serverHarness),
});
const labels = ["Background", "Text color", "Grid color", "Up", "Down"];
const hex = (page: Page, label = "Background") => page.getByRole("textbox", { name: label + " hex code", exact: true });
const apply = (page: Page) => page.getByRole("button", { name: "Apply as active preset", exact: true });
const reset = (page: Page) => page.getByRole("button", { name: /^Reset section/ });
const retry = (page: Page) => page.getByRole("button", { name: "Retry", exact: true });
type State = { settings: Record<string, unknown>; writes: Record<string, unknown>[]; fail: boolean; holdSave: Promise<void> | null; holdRead: Promise<void> | null; errors: string[] };
async function open(page: Page, harness: Harness) {
  const state: State = { settings: { backgroundColor: "#102030", textColor: "#d1e2f3", gridColor: "#304050", candleUpColor: "#12ab34", candleDownColor: "#cd3456", textSize: 14, timeHoursFormat: "12-hour", dateFormat: "MMM dd yyyy", gridMode: "vertical", bodyUpColor: "#12ab34", bodyDownColor: "#cd3456", watermarkText: "Preserve private metadata" }, writes: [], fail: false, holdSave: null, holdRead: null, errors: [] };
  const operations = new Map<string, any>();
  page.on("pageerror", error => state.errors.push(error.message));
  const item = (key: string, value: unknown) => ({ namespace: "edgelab", key, value, updated_at: "2026-10-08T10:00:00Z" });
  const response = () => ({ presets: item("chart-settings-presets.v1", [{ name: "Settings default", settings: { ...state.settings }, updatedAt: "2026-10-08T10:00:00Z" }]), active: item("active-chart-settings-preset.v1", "Settings default") });
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), body = req.postData() ? req.postDataJSON() : null, id = req.headers()["x-edgelab-operation-id"];
    const finish = async (status: number, json: unknown) => { if (id && operations.has(id)) operations.set(id, { ...operations.get(id), status: "completed", http_status: status, completed_at: "2026-10-08T10:00:01Z" }); await route.fulfill({ status, json }); };
    if (url.pathname.endsWith("/reserve")) { const receipt = { operation_id: url.pathname.split("/").at(-2), method: body.method, path: body.path, status: "reserved", http_status: null, result: null, created_at: "2026-10-08T10:00:00Z", completed_at: null }; operations.set(receipt.operation_id!, receipt); return route.fulfill({ json: receipt }); }
    if (url.pathname.endsWith("/recover")) return route.fulfill({ json: operations.get(url.pathname.split("/").at(-2)!) });
    if (url.pathname === "/api/settings/chart") {
      if (req.method() === "PATCH") {
        state.writes.push(structuredClone(body)); if (state.holdSave) await state.holdSave;
        if (state.fail) return finish(503, { detail: "Chart save unavailable" });
        Object.assign(state.settings, body, body.candleUpColor ? { bodyUpColor: body.candleUpColor } : {}, body.candleDownColor ? { bodyDownColor: body.candleDownColor } : {});
      } else if (state.holdRead) await state.holdRead;
      return finish(200, response());
    }
    if (url.pathname.endsWith("settings-center.v1")) return finish(200, item("settings-center.v1", { density: "comfortable", includeDiagnosticsByDefault: false }));
    return route.fulfill({ status: 404, json: { detail: "Unexpected boundary request" } });
  });
  await page.goto(harness.origin); await expect(hex(page)).toHaveValue("#102030"); return state;
}
function hold(state: State, key: "holdSave" | "holdRead") { let release!: () => void; state[key] = new Promise<void>(resolve => { release = resolve; }); return () => { state[key] = null; release(); }; }
async function popup(page: Page, label = "Background") {
  await page.getByRole("button", { name: label + " palette", exact: true }).click();
  const menu = page.getByRole("dialog", { name: new RegExp("^" + label + " #") }); await expect(menu).toBeVisible(); return menu;
}
test("invalid palette drafts block Apply and Retry without publishing invalid settings", async ({ page, harness }) => {
  const state = await open(page, harness);
  await hex(page).fill("#112233"); await hex(page, "Text color").fill("#GG");
  await expect(apply(page)).toBeDisabled(); await expect(hex(page, "Text color")).toHaveAttribute("aria-invalid", "true"); expect(state.writes).toEqual([]);
  const errorBox = page.locator(".themed-color-picker").filter({ has: hex(page, "Text color") }).getByRole("alert");
  const bounds = await errorBox.evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; });
  expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  await hex(page, "Text color").press("Escape"); await expect(hex(page, "Text color")).toHaveValue("#D1E2F3"); await expect(apply(page)).toBeEnabled();
  state.fail = true; await apply(page).click(); await expect(retry(page)).toBeVisible(); expect(state.writes).toEqual([{ backgroundColor: "#112233" }]);
  await hex(page, "Text color").fill("#GG"); await expect(retry(page)).toHaveCount(0); await expect(apply(page)).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  await hex(page, "Text color").press("Escape"); await expect(retry(page)).toBeVisible();
  state.fail = false; await retry(page).click(); await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(state.writes).toEqual([{ backgroundColor: "#112233" }, { backgroundColor: "#112233" }]); expect(state.settings.watermarkText).toBe("Preserve private metadata"); expect(state.errors).toEqual([]);
});
test("equal-value Reset and Undo clear local hex errors and restore staged palette values", async ({ page, harness }) => {
  const state = await open(page, harness);
  await reset(page).click(); await expect(hex(page)).toHaveValue("#0D1117");
  await hex(page).fill("#GG"); await expect(hex(page)).toHaveAttribute("aria-invalid", "true");
  await reset(page).click(); await expect(hex(page)).toHaveValue("#0D1117"); await expect(hex(page)).toHaveAttribute("aria-invalid", "false");
  await hex(page).fill("#GG"); await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect(hex(page)).toHaveValue("#0D1117"); await expect(hex(page)).toHaveAttribute("aria-invalid", "false");
  await hex(page).fill("#GG"); await reset(page).click(); await expect(page.getByRole("alert")).toHaveCount(0); expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("held saves capture one valid intent and preserve later edits after acknowledgment", async ({ page, harness }) => {
  const state = await open(page, harness); await hex(page).fill("#112233");
  const release = hold(state, "holdSave"); await apply(page).click(); await expect.poll(() => state.writes.length).toBe(1);
  await expect(apply(page)).toBeDisabled(); await hex(page).fill("#445566"); await expect(hex(page)).toHaveValue("#445566");
  expect(state.settings.backgroundColor).toBe("#102030"); release();
  await expect(apply(page)).toBeEnabled(); await expect(hex(page)).toHaveValue("#445566"); await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveCount(0);
  await apply(page).click(); await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  expect(state.writes).toEqual([{ backgroundColor: "#112233" }, { backgroundColor: "#445566" }]); expect(state.errors).toEqual([]);
});
test("account readiness closes the portal and incoming acknowledged colors replace old focused drafts", async ({ page, harness }) => {
  const state = await open(page, harness); const menu = await popup(page);
  await menu.getByRole("textbox", { name: "Background selected color hex code", exact: true }).fill("#GG");
  state.settings.backgroundColor = "#778899"; const release = hold(state, "holdRead");
  await page.evaluate(() => window.chart109.owner(10902)); await expect(menu).toBeHidden(); await expect(hex(page)).toBeDisabled();
  expect(state.writes).toEqual([]); release(); await expect(hex(page)).toBeEnabled(); await expect(hex(page)).toHaveValue("#778899");
  await expect(hex(page)).toHaveAttribute("aria-invalid", "false"); await expect(page.getByRole("alert")).toHaveCount(0); expect(state.errors).toEqual([]);
});
test("modern five palettes use themed bounded keyboard popups while compatibility retains native colors", async ({ page, harness }, info) => {
  const state = await open(page, harness);
  for (const label of labels) { await expect(hex(page, label)).toHaveAttribute("maxlength", "7"); await expect(page.getByRole("button", { name: label + " palette", exact: true })).toBeVisible(); }
  const menu = await popup(page); const selected = menu.getByRole("textbox", { name: "Background selected color hex code", exact: true });
  await expect(selected).toBeFocused(); await selected.fill("#abc"); await selected.press("Enter"); await expect(hex(page)).toHaveValue("#AABBCC");
  expect(state.writes).toEqual([]);
  const receipt = await menu.evaluate(element => { const r = element.getBoundingClientRect(), s = getComputedStyle(element), node = document.createElement("span"); node.style.backgroundColor = "var(--ui-floating)"; node.style.color = "var(--text-primary)"; document.body.append(node); const n = getComputedStyle(node); const result = { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight, background: s.backgroundColor, color: s.color, expectedBackground: n.backgroundColor, expectedColor: n.color }; node.remove(); return result; });
  expect(receipt.x).toBeGreaterThanOrEqual(0); expect(receipt.y).toBeGreaterThanOrEqual(0); expect(receipt.right).toBeLessThanOrEqual(receipt.width + 1); expect(receipt.bottom).toBeLessThanOrEqual(receipt.height + 1); expect(receipt.background).toBe(receipt.expectedBackground); expect(receipt.color).toBe(receipt.expectedColor);
  await expect.poll(() => menu.evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  if (process.env.EDGELAB_CHART109_CAPTURE !== "0") { const dir = path.join(root, ".artifacts/chart-palette109"); fs.mkdirSync(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, "final-" + info.project.name + ".png"), animations: "disabled" }); fs.writeFileSync(path.join(dir, "final-" + info.project.name + ".json"), JSON.stringify(receipt, null, 2)); }
  await selected.press("Escape"); await expect(menu).toBeHidden(); await expect(page.getByRole("button", { name: "Background palette", exact: true })).toBeFocused();
  await page.evaluate(() => window.chart109.compatibility(true));
  for (const label of labels) await expect(page.getByLabel(label, { exact: true })).toHaveAttribute("type", "color");
  await expect(page.getByRole("button", { name: "Background palette", exact: true })).toHaveCount(0); expect(state.errors).toEqual([]);
});
