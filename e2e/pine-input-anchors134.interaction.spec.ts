import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { productSetup, editor } from "./pine-layering.product-support";
import { bars } from "./support/replay-context";

const dist = path.resolve("frontend/dist");
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function inventory(directory = dist): { file: string; sha256: string }[] {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const full = path.join(directory, name);
    return fs.statSync(full).isDirectory() ? inventory(full) : [{ file: path.relative(dist, full), sha256: sha(fs.readFileSync(full)) }];
  });
}
let fixtureServer: http.Server, sealedFiles: ReturnType<typeof inventory>, fixtureWorker: { name: string; sha256: string; bytes: number }, fixtureRequests: string[];
test.beforeAll(async () => {
  sealedFiles = inventory(); fixtureRequests = [];
  const css = fs.readFileSync(path.join(dist, "index.html"), "utf8").match(/href="([^"]+\.css)"/)![1];
  const name = fs.readdirSync(path.join(dist, "assets")).find(name => /^pine-native-worker.*\.js$/.test(name))!;
  const worker = fs.readFileSync(path.join(dist, "assets", name)); fixtureWorker = { name, sha256: sha(worker), bytes: worker.length };
  const bundled = await build({ entryPoints: [path.resolve("e2e/pine-input-anchors134.fixture.tsx")], bundle: true, write: false,
    platform: "browser", format: "iife", globalName: "pineAnchorsProbe", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "sealed-production-worker", setup(builder) {
      builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "anchors134" }));
      builder.onLoad({ filter: /.*/, namespace: "anchors134" }, () => ({ contents: `export default ${JSON.stringify("/assets/" + name)}`, loader: "js" }));
    } }] });
  fixtureServer = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (url === "/") { response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${css}"><style>body{margin:16px;background:#080d18}#chart{width:100%}</style><div id="chart"></div><div id="root"></div><script src="/fixture.js"></script>`); return; }
    if (url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0].contents); return; }
    if (url === "/assets/" + name) fixtureRequests.push(url);
    const full = path.resolve(dist, "." + url);
    if (full.startsWith(dist + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      response.setHeader("Content-Type", url.endsWith(".js") ? "text/javascript" : url.endsWith(".css") ? "text/css" : url.endsWith(".woff2") ? "font/woff2" : "application/octet-stream"); response.end(fs.readFileSync(full)); return;
    }
    response.statusCode = url === "/favicon.ico" ? 204 : 404; response.end();
  });
  await new Promise<void>(resolve => fixtureServer.listen(45434, "127.0.0.1", resolve));
});
test.afterAll(async () => {
  if (fixtureServer) await new Promise<void>(resolve => fixtureServer.close(() => resolve()));
  expect(inventory()).toEqual(sealedFiles);
  const folder = path.resolve(".artifacts/pine-input-anchors134", test.info().project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "sealed-build.json"), JSON.stringify({ files: sealedFiles.length, unchanged: true, inventorySHA256: sha(JSON.stringify(sealedFiles)), fixtureWorker, fixtureRequests }, null, 2));
});

const pointSource = `//@version=6
indicator("Picked four-point zone", overlay=true, behind_chart=false)
p1=input.price(0,"Price 1",inline="1",group="Zone",confirm=true)
t1=input.time(0,"Time 1",inline="1",group="Zone",confirm=true)
p2=input.price(0,"Price 2",inline="2",group="Zone",confirm=true)
t2=input.time(0,"Time 2",inline="2",group="Zone",confirm=true)
p3=input.price(0,"Price 3",inline="3",group="Zone",confirm=true)
t3=input.time(0,"Time 3",inline="3",group="Zone",confirm=true)
p4=input.price(0,"Price 4",inline="4",group="Zone",confirm=true)
t4=input.time(0,"Time 4",inline="4",group="Zone",confirm=true)
if barstate.islast
    points=array.from(chart.point.from_time(t1,p1),chart.point.from_time(t2,p2),chart.point.from_time(t3,p3),chart.point.from_time(t4,p4))
    polyline.new(points,closed=true,xloc=xloc.bar_time,line_color=#ff00ff,fill_color=#00ff0020,line_width=3)`;

async function results(page: Page, source: string) {
  return page.evaluate(source => ((window as any).__layerResults ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    return response?.status === "completed" && response.result.kind === "run" && response.result.source === source
      ? [response.result] : [];
  }), source);
}
async function latest(page: Page, source: string, predicate: (result: any) => boolean = () => true) {
  await expect.poll(async () => (await results(page, source)).some(predicate)).toBe(true);
  return (await results(page, source)).findLast(predicate);
}
async function script(page: Page, source: string) {
  const dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  return dialog;
}
async function addUnchecked(page: Page, source: string) {
  const dialog = await script(page, source);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  return dialog;
}
async function closeEditor(page: Page) {
  const close = page.getByRole("button", { name: "Close indicator editor", exact: true });
  if (await close.isVisible()) await close.click();
}
function chip(page: Page, name: string) { return page.locator(".native-study-chip").filter({ hasText: name }).first(); }
async function selectStudy(page: Page, name: string, expectAnchors = true) {
  const pill = page.locator(".chart-study-pill[data-indicator-id]").filter({ hasText: name }).first();
  await expect(pill).toBeVisible(); await pill.click();
  if (expectAnchors) await expect(page.locator("[data-pine-input-anchors]").first()).toBeVisible();
  return chip(page, name);
}
async function closeSettings(page: Page) { const close = page.getByRole("button", { name: "Close indicator settings", exact: true }); if (await close.isVisible()) await close.click(); }
async function removeStudy(page: Page, name: string) {
  await closeSettings(page);
  await page.getByRole("button", { name: "Studies", exact: true }).click();
  const row = chip(page, name); await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Remove ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Close studies controls", exact: true }).click();
  await expect(page.locator(".chart-study-pill[data-indicator-id]").filter({ hasText: name })).toHaveCount(0);
}
async function capture(page: Page, info: TestInfo, name: string, locator?: Locator) {
  const folder = path.resolve(".artifacts/pine-input-anchors134", info.project.name); fs.mkdirSync(folder, { recursive: true });
  if (locator) { await locator.scrollIntoViewIfNeeded(); await locator.screenshot({ path: path.join(folder, name + ".png"), animations: "disabled" }); }
  else await page.screenshot({ path: path.join(folder, name + ".png"), animations: "disabled" });
}
async function frame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function pickCoordinate(page: Page, group: Locator, xFraction: number, yFraction: number, center = true, compactPane = false) {
  if (center) await group.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
  else await group.scrollIntoViewIfNeeded();
  await frame(page);
  const rect = await group.boundingBox(); expect(rect).not.toBeNull();
  const viewport = page.viewportSize()!;
  // Use the actual plot pane, which excludes both axes. Keep gestures clear
  // of picker prompts and the mobile bottom navigation.
  const left = Math.max(rect!.x + 16, 16), right = Math.min(rect!.x + rect!.width - 16, viewport.width - 16);
  const prompt = compactPane ? await group.locator("[data-pine-input-cancel]").locator("..").boundingBox() : null;
  const top = compactPane ? Math.max(rect!.y + rect!.height * .6, prompt!.y + prompt!.height + 6, 16) : Math.max(rect!.y + 120, 120);
  const bottom = Math.min(rect!.y + rect!.height - (compactPane ? 10 : 16), viewport.height - (compactPane ? 16 : 90));
  expect(right).toBeGreaterThan(left); expect(bottom).toBeGreaterThan(top);
  const point = { x: left + (right - left) * xFraction, y: top + (bottom - top) * yFraction };
  expect(await group.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), point)).toBe(true);
  return point;
}
async function moveInputs(page: Page, field: Locator) {
  await field.scrollIntoViewIfNeeded();
  expect(await field.evaluate(element => {
    const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === element && !hit.closest("[data-pine-input-anchor]");
  })).toBe(true);
  await page.getByRole("button", { name: "Move inputs on chart", exact: true }).click();
  await frame(page);
  await expect(page.locator(".indicator-floating-toolbar")).toHaveCount(0);
  await expect(page.locator("[data-pine-input-anchors]").first()).toBeVisible();
}
async function focusReceipt(page: Page, info: TestInfo, name: string) {
  const focused = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element ? { tag: element.tagName, className: element.className, label: element.getAttribute("aria-label"), text: element.textContent?.slice(0, 160), connected: element.isConnected } : null;
  });
  const folder = path.resolve(".artifacts/pine-input-anchors134", info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name + "-focus.json"), JSON.stringify(focused, null, 2));
  return focused;
}
async function drag(page: Page, handle: Locator, dx: number, dy: number, info: TestInfo, beforeRelease?: () => Promise<void>) {
  await handle.scrollIntoViewIfNeeded();
  const rect = await handle.boundingBox(); expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2, y = rect!.y + rect!.height / 2;
  if (info.project.name === "mobile") {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy }] });
    await frame(page); await beforeRelease?.();
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 });
    await frame(page); await beforeRelease?.(); await page.mouse.up();
  }
}
async function chartInk(page: Page, section = ".chart-stage") {
  return page.locator(section).first().evaluate(stage => {
    let ink = 0;
    for (const canvas of stage.querySelectorAll("canvas")) {
      const rgba = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!rgba) continue;
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i] > 210 && rgba[i + 1] < 40 && rgba[i + 2] > 210 && rgba[i + 3] > 0) ink++;
    }
    return ink;
  });
}
function nativePoints(result: any) {
  expect(result.polylines).toHaveLength(1);
  expect(result.polylines[0].xloc).toBe("bar_time");
  expect(result.polylines[0].points).toEqual([0, 2, 4, 6].map(index => ({ x: result.inputs[`in_${index + 1}`] / 1000, y: result.inputs[`in_${index}`] })));
}
async function receipt(info: TestInfo, state: Awaited<ReturnType<typeof productSetup>>, evidence: unknown, errors: string[]) {
  const name = fs.readdirSync("frontend/dist/assets").find(name => /^pine-native-worker.*\.js$/.test(name))!;
  const bytes = fs.readFileSync(path.join("frontend/dist/assets", name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  expect(state.workerReceipts.length).toBeGreaterThan(0);
  expect(state.workerReceipts.every(worker => worker.sha256 === sha256 && worker.bytes === bytes.length && new URL(worker.url).pathname.endsWith("/" + name))).toBe(true);
  expect(errors).toEqual([]);
  const folder = path.resolve(".artifacts/pine-input-anchors134", info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${info.title.replace(/[^a-z0-9]+/gi, "-")}.json`), JSON.stringify({ scope: "Actual production components and native Pine worker; only API/auth/storage fixtures are mocked", workerName: name, sha256, workerReceipts: state.workerReceipts, evidence, errors }, null, 2));
}

test("first-add cancellation leaves no study or saved script; four chart picks produce a real native polyline and atomic drag", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const state = await productSetup(page);
  let dialog = await addUnchecked(page, pointSource);
  let confirmation = page.getByRole("dialog", { name: "Confirm indicator inputs", exact: true });
  await expect(confirmation).toBeVisible();
  expect(await results(page, pointSource)).toEqual([]);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation).toHaveCount(0); await expect(chip(page, "Picked four-point zone")).toHaveCount(0);
  expect(state.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === pointSource) ?? false).toBe(false);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await confirmation.getByRole("button", { name: "Pick on chart", exact: true }).click();
  const firstPicker = page.getByRole("group", { name: /^Pick .+ on chart$/ }).first(); await expect(firstPicker).toBeVisible();
  const partial = await pickCoordinate(page, firstPicker, .5, .5);
  if (info.project.name === "mobile") await page.touchscreen.tap(partial.x, partial.y); else await page.mouse.click(partial.x, partial.y);
  await page.getByRole("button", { name: "Cancel input selection", exact: true }).click();
  await expect(confirmation).toBeVisible(); await expect(confirmation.getByLabel("Price 1", { exact: true })).toHaveValue("0");
  expect(await results(page, pointSource)).toEqual([]); await expect(chip(page, "Picked four-point zone")).toHaveCount(0);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === pointSource) ?? false).toBe(false);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await confirmation.getByRole("button", { name: "Pick on chart", exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(confirmation).toBeHidden();
  const picked: { x: number; y: number }[] = [];
  for (const [index, [x, y]] of [[.43, .35], [.55, .62], [.68, .4], [.8, .58]].entries()) {
    const group = page.getByRole("group", { name: `Pick Price ${index + 1} / Time ${index + 1} on chart`, exact: true });
    await expect(group).toBeVisible();
    const coordinate = await pickCoordinate(page, group, x, y);
    picked.push(coordinate);
    if (info.project.name === "mobile") await page.touchscreen.tap(coordinate.x, coordinate.y); else await page.mouse.click(coordinate.x, coordinate.y);
  }
  await expect(confirmation).toBeVisible(); expect(await results(page, pointSource)).toEqual([]);
  await capture(page, info, "confirmation-review");
  await confirmation.getByRole("button", { name: "Add with these inputs", exact: true }).click();
  await closeEditor(page);
  const initial = await latest(page, pointSource); nativePoints(initial);
  expect([1, 3, 5, 7].every(index => bars.some(bar => bar.time * 1000 === initial.inputs[`in_${index}`]))).toBe(true);
  expect([0, 2, 4, 6].every(index => Number.isFinite(initial.inputs[`in_${index}`]) && initial.inputs[`in_${index}`] > 67000)).toBe(true);
  await expect.poll(() => chartInk(page)).toBeGreaterThan(0);
  await selectStudy(page, "Picked four-point zone");
  const handles = page.locator('[data-pine-input-anchor][data-pine-input-kind="point"]'); await expect(handles).toHaveCount(4);
  await capture(page, info, "selected-main-controls");
  await moveInputs(page, page.locator(".indicator-floating-toolbar").getByLabel("Price 1", { exact: true }));
  await capture(page, info, "selected-main-inputs", page.locator(".chart-stage").first());
  const before = (await results(page, pointSource)).length;
  const target = handles.first();
  const hit = await target.boundingBox(); expect(hit!.width).toBe(44); expect(hit!.height).toBe(44);
  if (info.project.name === "mobile") await page.touchscreen.tap(hit!.x + 8, hit!.y + 10); else await page.mouse.click(hit!.x + 8, hit!.y + 10);
  await frame(page); expect((await results(page, pointSource)).length).toBe(before);
  await drag(page, target, info.project.name === "mobile" ? -22 : -36, 18, info, async () => {
    expect((await results(page, pointSource)).length).toBe(before);
  });
  const changed = await latest(page, pointSource, result => result.inputs.in_0 !== initial.inputs.in_0 && result.inputs.in_1 !== initial.inputs.in_1);
  nativePoints(changed); expect(Object.fromEntries(Object.entries(changed.inputs).filter(([id]) => !["in_0", "in_1"].includes(id)))).toEqual(Object.fromEntries(Object.entries(initial.inputs).filter(([id]) => !["in_0", "in_1"].includes(id))));
  const changedRuns = (await results(page, pointSource)).slice(before); expect(changedRuns.length).toBeGreaterThan(0);
  expect(changedRuns.every(result => result.inputs.in_0 === changed.inputs.in_0 && result.inputs.in_1 === changed.inputs.in_1)).toBe(true);
  await expect.poll(() => chartInk(page)).toBeGreaterThan(0);
  await capture(page, info, "selected-main-inputs", page.locator(".chart-stage").first());
  await closeSettings(page);
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByPlaceholder("Layout name", { exact: true }).fill("Picked input persistence");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("chart-layout.v1")?.indicatorInstances?.some((indicator: any) => indicator.customScriptSource === pointSource && indicator.settings.customInputs?.in_0 === changed.inputs.in_0 && indicator.settings.customInputs?.in_1 === changed.inputs.in_1) ?? false).toBe(true);
  // The shared visual fixture seeds an empty layout on every navigation. Keep
  // the exact records written by the app so reload exercises real persistence.
  const persisted = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("edgelab.chart-layout.v1.user-")));
  expect(persisted.some(([, value]) => value.includes("Picked four-point zone"))).toBe(true);
  await page.addInitScript(entries => { if (window === window.top) for (const [key, value] of entries) localStorage.setItem(key, value); }, persisted);
  await page.reload(); await latest(page, pointSource, result => result.inputs.in_0 === changed.inputs.in_0 && result.inputs.in_1 === changed.inputs.in_1);
  await receipt(info, state, { picked, initial, changed, changedRuns }, errors);
});

const stamp = Date.parse("2026-09-15T08:20:00Z");
function geometrySource(min: number, max: number, value: number) {
  return `//@version=6\nindicator("Native anchor geometry")\np=input.price(${value},"Level",inline="point",group="Probe")\nt=input.time(${stamp},"Moment",inline="point",group="Probe")\nplot(bar_index%2==0?${min}:${max},color=#aaaaaa)\nplot(p,color=#ff00ff)`;
}
async function probe(page: Page, operation: string, ...args: unknown[]) {
  return page.evaluate(({ operation, args }) => (window as any).pineAnchorsProbe[operation](...args), { operation, args });
}
test("genuine LWC normal logarithmic and inverted scales produce precise atomic drag values with no runtime runs during preview", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:45434/");
  const evidence: any[] = [];
  for (const [mode, invert] of [[0, false], [1, false], [1, true]] as const) {
    await probe(page, "boot", geometrySource(10, 400, 100)); await probe(page, "scale", mode, invert);
    const handle = page.locator('[data-pine-input-anchor][data-pine-input-kind="point"]'); await expect(handle).toHaveCount(1);
    const original = await probe(page, "summary"), coordinate = await probe(page, "projected", stamp / 1000, 100);
    const dy = 12, dx = info.project.name === "mobile" ? 16 : 24;
    const expected = await probe(page, "inverse", coordinate.pageX + dx, coordinate.pageY + dy);
    expect(expected.price).not.toBe(100); expect(expected.time).not.toBe(stamp / 1000);
    await drag(page, handle, dx, dy, info, async () => { const preview = await probe(page, "summary"); expect(preview.ledger).toEqual([]); expect(preview.results).toHaveLength(1); });
    await expect.poll(async () => (await probe(page, "summary")).results.length).toBe(2);
    const applied = await probe(page, "summary"); expect(applied.ledger).toHaveLength(1);
    expect(Object.keys(applied.ledger[0]).sort()).toEqual(["in_0", "in_1"]);
    expect(applied.last.inputs.in_0).toBeCloseTo(expected.price, 8); expect(applied.last.inputs.in_1).toBe(expected.time * 1000);
    expect(invert ? applied.last.inputs.in_0 > 100 : applied.last.inputs.in_0 < 100).toBe(true);
    const position = await probe(page, "projected", applied.last.inputs.in_1 / 1000, applied.last.inputs.in_0);
    expect(Number.isFinite(position.pageX + position.pageY)).toBe(true);
    evidence.push({ mode, invert, original: original.last.inputs, expected, applied: applied.last.inputs, ledger: applied.ledger, position });
  }
  expect(errors).toEqual([]); expect(fixtureRequests.length).toBeGreaterThan(0);
  const folder = path.resolve(".artifacts/pine-input-anchors134", info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "scale-coordinates.json"), JSON.stringify({ scope: "Real component and pinned LWC coordinate probe, actual sealed native worker; app workflow tested separately", fixtureWorker, evidence, errors }, null, 2));
});

test("zero and negative pane prices, keyboard atomic commit, Escape and owner/hide disposal cancel pending input edits", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:45434/"); await probe(page, "boot", geometrySource(-10, 10, 0));
  let handle = page.locator('[data-pine-input-anchor][data-pine-input-kind="point"]'); await expect(handle).toHaveCount(1);
  await handle.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowRight");
  expect((await probe(page, "summary")).ledger).toEqual([]); await page.keyboard.press("Enter");
  await expect.poll(async () => (await probe(page, "summary")).results.length).toBe(2);
  const changed = await probe(page, "summary"); expect(changed.last.inputs.in_0).toBeLessThan(0); expect(changed.last.inputs.in_1).toBe(stamp + 60_000); expect(changed.ledger).toHaveLength(1);
  await handle.focus(); await page.keyboard.press("ArrowUp"); await page.keyboard.press("Escape"); expect((await probe(page, "summary")).ledger).toHaveLength(1);
  await probe(page, "boot", geometrySource(-10, 10, 0)); handle = page.locator('[data-pine-input-anchor][data-pine-input-kind="point"]');
  await drag(page, handle, 16, 10, info, async () => { await probe(page, "changeOwner", "new-chart-source-auth-owner"); });
  expect((await probe(page, "summary")).ledger).toEqual([]); expect((await probe(page, "summary")).results).toHaveLength(1);
  await drag(page, handle, 16, 10, info, async () => { await probe(page, "show", false); });
  await expect(page.locator("[data-pine-input-anchors]")).toHaveCount(0); expect((await probe(page, "summary")).ledger).toEqual([]);
  await probe(page, "show", true); await expect(handle).toHaveCount(1);
  await probe(page, "pan", 30, 45); await expect(handle).toHaveCount(0);
  await probe(page, "pan", 5, 40); await expect(handle).toHaveCount(1);
  await probe(page, "resize", info.project.name === "mobile" ? 300 : 700); await expect(handle).toBeVisible();
  await probe(page, "dispose"); await expect(page.locator("[data-pine-input-anchors]")).toHaveCount(0);
  expect(errors).toEqual([]); const folder = path.resolve(".artifacts/pine-input-anchors134", info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "owner-keyboard.json"), JSON.stringify({ changed: changed.last.inputs, ledger: changed.ledger, fixtureWorker, errors }, null, 2));
});

const unpairedSource = `//@version=6
indicator("Independent input markers",overlay=true,behind_chart=false)
p=input.price(${bars[84].close},"Unpaired level",inline="shared",group="A")
t=input.time(${bars[80].time * 1000},"Unpaired moment",inline="shared",group="A")
third=input.bool(true,"Third row member",inline="shared",group="A")
p2=input.price(${bars[84].close + 15},"Different-group level",inline="same",group="B")
t2=input.time(${bars[84].time * 1000},"Different-group moment",inline="same",group="C")
p3=input.price(${bars[84].close + 30},"Paired level",inline="unique",group="D")
t3=input.time(${bars[88].time * 1000},"Paired moment",inline="unique",group="D")
plot(p,color=#ff00ff,linewidth=3)`;
test("actual app keeps price/time markers independent for ambiguous inline rows and separate groups; UTC edits and hide/remove clean owned handles", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const state = await productSetup(page); await addUnchecked(page, unpairedSource); await closeEditor(page);
  const initial = await latest(page, unpairedSource); await selectStudy(page, "Independent input markers");
  await expect(page.locator('[data-pine-input-kind="price"]')).toHaveCount(2);
  await expect(page.locator('[data-pine-input-kind="time"]')).toHaveCount(2);
  await expect(page.locator('[data-pine-input-kind="point"]')).toHaveCount(1);
  const date = page.locator(".indicator-floating-toolbar").getByLabel("Unpaired moment", { exact: true }); await expect(date).toHaveAttribute("type", "datetime-local");
  await date.fill(""); await expect(date).toHaveAttribute("aria-invalid", "true"); await date.press("Enter");
  expect((await results(page, unpairedSource)).at(-1).inputs.in_1).toBe(initial.inputs.in_1);
  const changedTime = bars[81].time * 1000 + 123;
  await date.fill(new Date(changedTime).toISOString().slice(0, -1)); await date.press("Enter");
  const edited = await latest(page, unpairedSource, result => result.inputs.in_1 === changedTime);
  expect(edited.inputs.in_0).toBe(initial.inputs.in_0);
  await moveInputs(page, date);
  const timeHandle = page.getByRole("button", { name: "Move Unpaired moment time input", exact: true });
  const baseline = (await results(page, unpairedSource)).length;
  await timeHandle.focus(); await page.keyboard.press("ArrowRight"); expect((await results(page, unpairedSource)).length).toBe(baseline);
  await page.keyboard.press("Enter"); const movedTime = await latest(page, unpairedSource, result => result.inputs.in_1 === bars[82].time * 1000);
  expect(movedTime.inputs.in_0).toBe(initial.inputs.in_0);
  const priceHandle = page.getByRole("button", { name: "Move Unpaired level price input", exact: true });
  await priceHandle.focus(); await page.keyboard.press("ArrowUp"); await page.keyboard.press("Enter");
  const movedPrice = await latest(page, unpairedSource, result => result.inputs.in_0 > initial.inputs.in_0);
  expect(movedPrice.inputs.in_1).toBe(movedTime.inputs.in_1);
  await closeSettings(page);
  await page.getByRole("button", { name: "Objects", exact: true }).first().click();
  const object = page.locator(".indicator-object-row").filter({ hasText: "Independent input markers" }).first();
  await object.getByRole("button", { name: /^On: Hide / }).click(); await expect(page.locator("[data-pine-input-anchors]")).toHaveCount(0);
  await object.getByRole("button", { name: /^Off: Show / }).click();
  await page.getByRole("button", { name: "Collapse chart objects", exact: true }).click();
  await selectStudy(page, "Independent input markers"); await expect(priceHandle).toBeVisible();
  await removeStudy(page, "Independent input markers");
  await expect(page.locator("[data-pine-input-anchors]")).toHaveCount(0);
  await expect.poll(() => chartInk(page)).toBe(0);
  await receipt(info, state, { initial, edited, movedTime, movedPrice }, errors);
});

const paneSource = `//@version=6
indicator("Signed pane inputs",overlay=false)
threshold=input.price(0,"Signed threshold")
plot(bar_index%2==0?-10:10,color=#aaaaaa)
plot(threshold,color=#ff00ff,linewidth=3)`;
test("actual separate Pine pane uses its native numeric scale for zero and negative price inputs", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const state = await productSetup(page); await addUnchecked(page, paneSource); await closeEditor(page);
  const initial = await latest(page, paneSource); expect(initial.inputs.in_0).toBe(0);
  const pane = page.getByRole("region", { name: "Signed pane inputs native Pine pane", exact: true }); await expect(pane).toBeVisible();
  const title = pane.getByRole("button", { name: "Signed pane inputs", exact: true }); await title.click();
  const handle = pane.getByRole("button", { name: "Move Signed threshold price input", exact: true }); await expect(handle).toBeVisible();
  await moveInputs(page, page.locator(".indicator-floating-toolbar").getByLabel("Signed threshold", { exact: true }));
  const bounds = await handle.boundingBox(); expect(bounds!.width).toBe(44); expect(bounds!.height).toBe(44);
  const before = (await results(page, paneSource)).length;
  await handle.focus(); await page.keyboard.press("ArrowDown"); expect((await results(page, paneSource)).length).toBe(before); await page.keyboard.press("Enter");
  const changed = await latest(page, paneSource, result => result.inputs.in_0 < 0);
  expect(changed.inputs.in_0).toBeGreaterThan(-10); await expect(handle).toBeVisible();
  await title.click();
  const pick = page.locator(".indicator-floating-toolbar").getByRole("button", { name: "Pick Signed threshold on chart", exact: true });
  await expect(pick).toBeEnabled(); await pick.click();
  const group = pane.getByRole("group", { name: "Pick Signed threshold on chart", exact: true }); await expect(group).toBeVisible();
  await group.getByRole("button", { name: "Cancel picking Signed threshold", exact: true }).click();
  await expect(group).toHaveCount(0); await expect(pick).toBeFocused(); expect((await results(page, paneSource)).at(-1).inputs.in_0).toBe(changed.inputs.in_0);
  await pick.click(); await expect(group).toBeVisible();
  const coordinate = await pickCoordinate(page, group, .6, .8, true, true);
  if (info.project.name === "mobile") await page.touchscreen.tap(coordinate.x, coordinate.y); else await page.mouse.click(coordinate.x, coordinate.y);
  const picked = await latest(page, paneSource, result => result.inputs.in_0 < -1);
  await expect(group).toHaveCount(0); await expect(handle).toBeVisible(); await frame(page);
  const focused = await focusReceipt(page, info, "pane-committed-pick");
  await capture(page, info, "selected-pane-controls");
  await expect.poll(async () => await pick.evaluate(element => element === document.activeElement) || await title.evaluate(element => element === document.activeElement)).toBe(true);
  await expect.poll(() => chartInk(page, '[aria-label="Signed pane inputs native Pine pane"]')).toBeGreaterThan(0);
  await moveInputs(page, page.locator(".indicator-floating-toolbar").getByLabel("Signed threshold", { exact: true }));
  await handle.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" })); await frame(page);
  await capture(page, info, "selected-pane-inputs");
  await receipt(info, state, { initial, changed, picked, bounds, coordinate, focused }, errors);
});

const dynamicSource = `//@version=6
indicator("Dynamic confirm inputs",overlay=true,behind_chart=false)
first=input.price(0,"First level",confirm=true)
second=input.price(2,"Later level",confirm=true,active=first<1)
plot(first,color=#ff00ff,linewidth=3)`;
test("actual confirmation picker skips inputs that become inactive after a pick and returns an editable review instead of hanging", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const state = await productSetup(page); await addUnchecked(page, dynamicSource);
  const confirmation = page.getByRole("dialog", { name: "Confirm indicator inputs", exact: true });
  await expect(confirmation).toBeVisible(); await expect(confirmation.getByLabel("Later level", { exact: true })).toBeEnabled();
  await confirmation.getByRole("button", { name: "Pick on chart", exact: true }).click();
  const group = page.getByRole("group", { name: "Pick First level on chart", exact: true }); await expect(group).toBeVisible();
  // Keep the ordinary scroll position: this valid touch ends where the review
  // Add button opens, proving the pick cannot also submit the new dialog.
  const { x, y } = await pickCoordinate(page, group, .6, .5, false);
  await page.evaluate(() => {
    (window as any).__pickGestureEvents = [];
    for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "click"]) document.addEventListener(type, event => {
      const target = event.target as HTMLElement;
      const mouse = event as MouseEvent;
      const record = { type, tag: target.tagName, label: target.getAttribute("aria-label"), text: target.textContent?.slice(0, 160), detail: mouse.detail, clientX: mouse.clientX, clientY: mouse.clientY, defaultPrevented: event.defaultPrevented };
      (window as any).__pickGestureEvents.push(record);
      queueMicrotask(() => { record.defaultPrevented = event.defaultPrevented; });
    }, { capture: true, passive: true });
  });
  if (info.project.name === "mobile") await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  try { await expect(confirmation).toBeVisible(); }
  finally {
    const folder = path.resolve(".artifacts/pine-input-anchors134", info.project.name); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "dynamic-pick-review.json"), JSON.stringify({ x, y, events: await page.evaluate(() => (window as any).__pickGestureEvents), results: await results(page, dynamicSource), storage: Object.fromEntries(state.storage), reviewVisible: await confirmation.isVisible() }, null, 2));
  }
  await expect(page.getByRole("group", { name: /^Pick .+ on chart$/ })).toHaveCount(0);
  await expect(confirmation.getByLabel("Later level", { exact: true })).toBeDisabled();
  await expect(confirmation.getByLabel("Later level", { exact: true })).toHaveValue("2");
  const first = Number(await confirmation.getByLabel("First level", { exact: true }).inputValue()); expect(first).toBeGreaterThan(67000);
  expect(await results(page, dynamicSource)).toEqual([]);
  expect(state.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === dynamicSource) ?? false).toBe(false);
  await expect(page.locator(".chart-study-pill[data-indicator-id]").filter({ hasText: "Dynamic confirm inputs" })).toHaveCount(0);
  const deliberateAdd = confirmation.getByRole("button", { name: "Add with these inputs", exact: true });
  if (info.project.name === "mobile") await deliberateAdd.tap(); else await deliberateAdd.click();
  await closeEditor(page);
  const applied = await latest(page, dynamicSource); expect(applied.inputs.in_0).toBe(first); expect(applied.inputs.in_1).toBe(2);
  await selectStudy(page, "Dynamic confirm inputs");
  await expect(page.getByRole("button", { name: "Move First level price input", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move Later level price input", exact: true })).toHaveCount(0);
  await removeStudy(page, "Dynamic confirm inputs"); await expect(page.locator("[data-pine-input-anchors]")).toHaveCount(0);
  const unplacedSource = `//@version=6\nindicator("Unplaced input controls",overlay=false)\np=input.price(0,"Unplaced price")\nt=input.time(${bars[80].time * 1000},"Unplaced time")\nif barstate.islast\n    label.new(bar_index,close,"Forced only",force_overlay=true)`;
  await addUnchecked(page, unplacedSource); await closeEditor(page); await latest(page, unplacedSource);
  await selectStudy(page, "Unplaced input controls", false);
  const controls = page.locator(".indicator-floating-toolbar");
  await expect(controls.getByRole("button", { name: "Pick Unplaced price on chart", exact: true })).toBeDisabled();
  await expect(controls.getByRole("button", { name: "Pick Unplaced time on chart", exact: true })).toBeDisabled();
  await expect(controls.getByLabel("Unplaced price", { exact: true })).toBeEnabled();
  await expect(controls.getByLabel("Unplaced time", { exact: true })).toBeEnabled();
  await controls.getByLabel("Unplaced price", { exact: true }).fill("-2");
  const manual = await latest(page, unplacedSource, result => result.inputs.in_0 === -2);
  expect(manual.labels).toHaveLength(1); expect(manual.labels[0].forceOverlay).toBe(true);
  await expect(page.locator("[data-pine-input-anchors]")).toHaveCount(0);
  await receipt(info, state, { picked: { x, y }, first, applied, manual }, errors);
});
