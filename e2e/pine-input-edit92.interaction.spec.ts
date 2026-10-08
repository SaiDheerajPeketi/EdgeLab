import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
declare global { interface Window { pineInputEditFixture: any } }
const root = path.resolve(import.meta.dirname, "..");
const baseline = process.env.EDGELAB_INPUT_EDIT92_BASELINE === "1";
const bars = JSON.parse(fs.readFileSync(path.join(root, "e2e/pine-visuals.bars.json"), "utf8")).slice(0, 4);
const code = (body: string) => '//@version=6\nindicator("Numeric edits92")\n' + body;
const integerSource = code('enabled=input.bool(true,"Enable")\nlength=input.int(20,"Length",minval=1,maxval=100,active=enabled)\nplot(length,"Output")');
type Harness = { origin: string; workerRequests: string[] };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const assets = path.join(root, "frontend/dist/assets");
    const workerName = fs.readdirSync(assets).find(name => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("Build the genuine production worker before this suite.");
    const workerPath = "/assets/" + workerName, worker = fs.readFileSync(path.join(assets, workerName));
    const workerRequests: string[] = [];
    const bundle = (await build({ entryPoints: [path.join(root, "e2e/pine-input-edit92.fixture.tsx")], bundle: true, minify: true,
      write: false, format: "iife", jsx: "automatic", platform: "browser", define: { "import.meta.env": "{}" },
      plugins: [{ name: "actual-production-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "edit92" }));
        builder.onLoad({ filter: /.*/, namespace: "edit92" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
        if (baseline) builder.onLoad({ filter: /PineInputControl\.tsx$/ }, args => ({
          contents: fs.readFileSync(path.join(root, ".artifacts/pine-input-edit92-baseline/PineInputControl.tsx"), "utf8"), loader: "tsx", resolveDir: path.dirname(args.path),
        }));
      } }] })).outputFiles[0].contents;
    const css = fs.readdirSync(assets).filter(name => name.endsWith(".css")).map(name => fs.readFileSync(path.join(assets, name))).join("\n");
    fs.mkdirSync(path.join(root, ".artifacts"), { recursive: true });
    fs.writeFileSync(path.join(root, `.artifacts/pine-input-edit92-${baseline ? "baseline" : "final"}-assets.json`), JSON.stringify({
      worker: workerName, workerSha256: createHash("sha256").update(worker).digest("hex"), fixtureSha256: createHash("sha256").update(bundle).digest("hex"),
    }, null, 2));
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'); }
      else if (pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle); }
      else if (pathname === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
      else if (pathname === workerPath) { workerRequests.push(workerPath); response.setHeader("Content-Type", "text/javascript"); response.end(worker); }
      else { response.statusCode = 404; response.end(); }
    });
    await new Promise<void>(resolve => server.listen(45194, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:45194", workerRequests }); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }, { scope: "worker" }],
  harness: [async ({ page, serverHarness }, use) => {
    serverHarness.workerRequests.length = 0;
    const pageErrors: string[] = []; page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(serverHarness.origin);
    await expect.poll(() => page.evaluate(() => typeof window.pineInputEditFixture?.prepare)).toBe("function");
    await page.evaluate(bars => { window.pineInputEditFixture.bars = bars; }, bars);
    await use(serverHarness);
    expect(pageErrors).toEqual([]);
  }, { auto: true }],
});
const modern = () => test.skip(baseline);
const length = page => page.getByRole("spinbutton", { name: "Length", exact: true });
const current = page => page.evaluate(() => window.pineInputEditFixture.current);
async function prepare(page, source = integerSource) {
  const prepared = await page.evaluate(source => window.pineInputEditFixture.prepare(source), source);
  await expect(page.getByRole("spinbutton").first()).toBeVisible(); return prepared;
}
async function assertOutput(page, value: number) {
  await expect.poll(async () => (await current(page)).result?.plots[0]?.points.map(point => point.value)).toEqual(Array(4).fill(value));
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
}

test("baseline deleting numeric content restores the old value immediately", async ({ page, harness }, info) => {
  test.skip(!baseline); await prepare(page); await length(page).selectText(); await length(page).press("Backspace");
  await expect(length(page)).toHaveValue("20"); expect((await current(page)).emissions).toEqual([]); expect(harness.workerRequests).toHaveLength(1);
  await page.screenshot({ path: path.join(root, `.artifacts/pine-input-edit92-baseline-empty-${info.project.name}.png`) });
});
test("baseline invalid integers dispatch to the genuine worker and fail the indicator", async ({ page }, info) => {
  test.skip(!baseline); await prepare(page); await length(page).fill("0");
  await expect.poll(async () => (await current(page)).error).toMatch(/outside its declared range/);
  expect((await current(page)).inputs.in_1).toBe(0);
  await length(page).fill("1.5"); await expect.poll(async () => (await current(page)).runs.length).toBe(2);
  await expect.poll(async () => (await current(page)).error).toMatch(/outside its declared range/);
  expect((await current(page)).emissions.map(item => item.value)).toEqual([0, 1.5]);
  await page.screenshot({ path: path.join(root, `.artifacts/pine-input-edit92-baseline-invalid-${info.project.name}.png`) });
});
test("empty edit is preserved locally and a valid replacement previews through the real worker", async ({ page, harness }, info) => {
  modern(); const prepared = await prepare(page); expect(prepared.inputDefinitions[1]).toMatchObject({ type: "int", defval: 20, minval: 1, maxval: 100 });
  await length(page).selectText(); await length(page).press("Backspace"); await expect(length(page)).toHaveValue("");
  expect((await current(page)).inputs.in_1).toBe(20); expect((await current(page)).runs).toEqual([]); expect(harness.workerRequests).toHaveLength(1);
  await length(page).fill("25"); await assertOutput(page, 25);
  expect((await current(page)).emissions).toEqual([{ id: "in_1", value: 25 }]); expect(harness.workerRequests).toHaveLength(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(root, `.artifacts/pine-input-edit92-valid-${info.project.name}.png`), fullPage: true });
});
test("invalid integer drafts remain readable without dispatch and Escape restores the latest valid value", async ({ page, harness }, info) => {
  modern(); await prepare(page); await length(page).fill("25"); await assertOutput(page, 25);
  for (const invalid of ["0", "101", "1.5", "9007199254740992"]) {
    await length(page).fill(invalid); await length(page).press("Tab");
    await expect(length(page)).toHaveValue(invalid); await expect(length(page)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect((await current(page)).inputs.in_1).toBe(25); expect((await current(page)).runs).toHaveLength(1);
    if (invalid === "0") await page.screenshot({ path: path.join(root, `.artifacts/pine-input-edit92-invalid-${info.project.name}.png`), fullPage: true });
    await length(page).press("Escape"); await expect(length(page)).toHaveValue("25");
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  expect(harness.workerRequests).toHaveLength(2);
});
test("float signed drafts and nonfinite input never publish an intermediate invalid value", async ({ page }) => {
  modern(); await prepare(page, code('amount=input.float(2.5,"Amount",minval=-100,maxval=100)\nplot(amount,"Output")'));
  const amount = page.getByRole("spinbutton", { name: "Amount", exact: true });
  await amount.selectText(); await amount.press("-"); expect((await current(page)).runs).toHaveLength(0);
  await amount.fill("-2.75"); await assertOutput(page, -2.75); expect((await current(page)).inputs.in_0).toBe(-2.75);
  await amount.selectText(); await amount.fill("1e309"); await amount.press("Tab");
  await expect(amount).toHaveAttribute("aria-invalid", "true"); expect((await current(page)).inputs.in_0).toBe(-2.75);
  // A prefix may be a legitimate finite preview, but NaN/Infinity must never reach the worker.
  expect((await current(page)).emissions.every(item => Number.isFinite(item.value))).toBe(true);
  await amount.press("Escape"); const restored = await amount.inputValue();
  expect(Number.isFinite(Number(restored))).toBe(true);
});
test("disabled input clears its invalid local draft and cannot dispatch an edit", async ({ page, harness }) => {
  modern(); await prepare(page); await length(page).fill("0"); expect((await current(page)).runs).toHaveLength(0);
  await page.getByRole("checkbox", { name: "Enable", exact: true }).uncheck();
  await expect(length(page)).toBeDisabled(); await expect(length(page)).toHaveValue("20"); await assertOutput(page, 20);
  const published = (await current(page)).emissions;
  await length(page).evaluate((input: HTMLInputElement) => { input.value = "99"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect((await current(page)).emissions).toEqual(published); expect((await current(page)).inputs.in_1).toBe(20);
  expect(harness.workerRequests).toHaveLength(2);
  await page.getByRole("checkbox", { name: "Enable", exact: true }).check(); await expect(length(page)).toBeEnabled();
  await length(page).fill("30"); await assertOutput(page, 30);
});
test("external reset and a changed definition discard stale invalid drafts without a worker run", async ({ page, harness }) => {
  modern(); await prepare(page); await length(page).fill("0");
  await page.evaluate(() => window.pineInputEditFixture.externalValue("in_1", 40));
  await expect(length(page)).toHaveValue("40"); await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await current(page)).runs).toHaveLength(0);
  await length(page).fill("0"); await prepare(page, integerSource.replace("maxval=100", "maxval=200"));
  await expect(length(page)).toHaveValue("20"); await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await current(page)).inputs.in_1).toBe(20); expect((await current(page)).runs).toHaveLength(0); expect(harness.workerRequests).toHaveLength(2);
});

test("time inputs retain exact safe millisecond integers and never dispatch a fractional or unsafe timestamp", async ({ page, harness }) => {
  modern(); const initial = 1770000000000;
  const prepared = await prepare(page, code('when=input.time(1770000000000,"Start")\nplot(when,"Output")'));
  expect(prepared.inputDefinitions[0]).toMatchObject({ type: "time", defval: initial });
  const time = page.getByRole("spinbutton", { name: "Start", exact: true });
  for (const invalid of ["1770000000000.5", "9007199254740992"]) {
    await time.fill(invalid); await time.press("Tab");
    await expect(time).toHaveAttribute("aria-invalid", "true"); await expect(time).toHaveValue(invalid);
    expect((await current(page)).inputs.in_0).toBe(initial); expect((await current(page)).runs).toHaveLength(0);
    await time.press("Escape"); await expect(time).toHaveValue(String(initial));
  }
  await time.fill("1770000000100"); await assertOutput(page, 1770000000100);
  expect((await current(page)).emissions).toEqual([{ id: "in_0", value: 1770000000100 }]);
  expect(harness.workerRequests).toHaveLength(2); await expect(page.getByRole("alert")).toHaveCount(0);
});
