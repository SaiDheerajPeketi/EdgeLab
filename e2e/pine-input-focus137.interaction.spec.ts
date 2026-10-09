import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { productSetup, editor } from "./pine-layering.product-support";
import { bars } from "./support/replay-context";

const dist = path.resolve("frontend/dist");
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const repro = process.env.EDGELAB_INPUT_FOCUS137_REPRO === "1";
function inventory(directory = dist): { file: string; sha256: string }[] {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const full = path.join(directory, name);
    return fs.statSync(full).isDirectory() ? inventory(full) : [{ file: path.relative(dist, full), sha256: hash(fs.readFileSync(full)) }];
  });
}
let sealed: ReturnType<typeof inventory>;
test.beforeAll(() => { sealed = inventory(); });
test.afterAll(() => {
  expect(inventory()).toEqual(sealed);
  const folder = path.resolve(".artifacts/pine-input-focus137", repro ? "before-fix" : "final", test.info().project.name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "sealed-build.json"), JSON.stringify({ files: sealed.length, unchanged: true, inventorySHA256: hash(JSON.stringify(sealed)) }, null, 2));
});
async function frame(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function completed(page: Page, source: string) {
  return page.evaluate(source => ((window as any).__layerResults ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    return response?.status === "completed" && response.result.kind === "run" && response.result.source === source ? [response.result] : [];
  }), source);
}
async function latest(page: Page, source: string, predicate: (result: any) => boolean) {
  await expect.poll(async () => (await completed(page, source)).some(predicate)).toBe(true);
  return (await completed(page, source)).findLast(predicate);
}
async function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element ? { tag: element.tagName, label: element.getAttribute("aria-label"), text: element.textContent?.slice(0, 100),
      className: element.className, connected: element.isConnected } : null;
  });
}
async function coordinate(page: Page, group: Locator, pane: boolean) {
  await group.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" })); await frame(page);
  const bounds = await group.boundingBox(); expect(bounds).not.toBeNull();
  const prompt = await group.locator("[data-pine-input-cancel]").locator("..").boundingBox(); expect(prompt).not.toBeNull();
  const viewport = page.viewportSize()!;
  const left = Math.max(bounds!.x + 16, 16), right = Math.min(bounds!.x + bounds!.width - 16, viewport.width - 16);
  const top = Math.max(bounds!.y + (pane ? bounds!.height * .6 : 120), prompt!.y + prompt!.height + 6, 16);
  const bottom = Math.min(bounds!.y + bounds!.height - 10, viewport.height - (pane ? 16 : 90));
  expect(right).toBeGreaterThan(left); expect(bottom).toBeGreaterThan(top);
  const point = { x: (left + right) / 2, y: top + (bottom - top) * .65 };
  expect(await group.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), point)).toBe(true);
  return { point, bounds, prompt };
}

for (const pane of [false, true]) test(`${pane ? "native pane" : "main chart"} paired picks restore owned focus when the time member becomes inactive`, async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const name = `Paired focus137 ${pane ? "pane" : "main"}`;
  const initialPrice = pane ? -1_000_000 : 0, limit = pane ? -999_999 : 1;
  const initialTime = bars[40].time * 1000;
  const source = `//@version=6\nindicator("${name}",overlay=${!pane})\nprice=input.price(${initialPrice},"Pair price",inline="point",group="Point")\nstamp=input.time(${initialTime},"Pair time",inline="point",group="Point",active=price<=${limit})\nplot(${pane ? "bar_index%2==0?-10:10" : "close"},"Scale")\nplot(price*0${pane ? "" : "+close"},"Input witness")`;
  const state = await productSetup(page);
  const dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const initial = await latest(page, source, result => result.inputs.in_0 === initialPrice && result.inputs.in_1 === initialTime);
  const region = pane ? page.getByRole("region", { name: `${name} native Pine pane`, exact: true }) : page.locator(".chart-stage").first();
  const trigger = pane ? region.getByRole("button", { name, exact: true })
    : page.locator(".chart-study-pill[data-indicator-id]").filter({ hasText: name }).first();
  await trigger.click();
  const toolbar = page.locator(".indicator-floating-toolbar");
  const price = toolbar.getByLabel("Pair price", { exact: true });
  const time = toolbar.getByLabel("Pair time", { exact: true });
  const pricePick = toolbar.getByRole("button", { name: "Pick Pair price on chart", exact: true });
  const timePick = toolbar.getByRole("button", { name: "Pick Pair time on chart", exact: true });
  const close = toolbar.getByRole("button", { name: "Close indicator settings", exact: true });
  const group = region.getByRole("group", { name: "Pick Pair price / Pair time on chart", exact: true });
  await expect(pricePick).toBeEnabled(); await expect(timePick).toBeEnabled();
  const beforeCancel = (await completed(page, source)).length;
  await pricePick.click(); await expect(group).toBeVisible();
  const cancel = group.getByRole("button", { name: "Cancel picking Pair price / Pair time", exact: true });
  if (info.project.name === "mobile") await cancel.tap(); else await cancel.click();
  await expect(group).toHaveCount(0); await expect(pricePick).toBeFocused();
  expect((await completed(page, source)).length).toBe(beforeCancel);
  const evidence: any = { initial, cancelFocus: await focused(page), picks: [] };
  for (const member of ["price", "time"] as const) {
    if (member === "time") {
      const beforeReset = (await completed(page, source)).length;
      await price.fill(String(initialPrice)); await price.press("Enter");
      await expect.poll(async () => (await completed(page, source)).length).toBeGreaterThan(beforeReset);
      expect((await completed(page, source)).at(-1).inputs.in_0).toBe(initialPrice);
      await expect(time).toBeEnabled(); await expect(timePick).toBeEnabled();
    }
    const baseline = (await completed(page, source)).length;
    await (member === "price" ? pricePick : timePick).click(); await expect(group).toBeVisible();
    const geometry = await coordinate(page, group, pane);
    if (info.project.name === "mobile") await page.touchscreen.tap(geometry.point.x, geometry.point.y);
    else await page.mouse.click(geometry.point.x, geometry.point.y);
    await expect.poll(async () => (await completed(page, source)).length).toBeGreaterThan(baseline);
    const result = (await completed(page, source)).at(-1);
    expect(result.inputs.in_0).toBeGreaterThan(limit); expect(result.inputs.in_1).not.toBe(initialTime);
    await expect(group).toHaveCount(0); await expect(price).toBeEnabled(); await expect(time).toBeDisabled();
    await expect(pricePick).toBeDisabled(); await expect(timePick).toBeDisabled(); await frame(page);
    const current = await completed(page, source); expect(current.length).toBeGreaterThan(baseline);
    expect(result.inputs.in_0).toBeGreaterThan(pane ? -10 : 60_000);
    expect(bars.some(bar => bar.time * 1000 === result.inputs.in_1)).toBe(true);
    if (!repro) await expect(member === "price" ? price : close).toBeFocused();
    evidence.picks.push({ member, geometry, result, focused: await focused(page) });
    const folder = path.resolve(".artifacts/pine-input-focus137", repro ? "before-fix" : "final", info.project.name);
    fs.mkdirSync(folder, { recursive: true }); await page.screenshot({ path: path.join(folder, `${pane ? "pane" : "main"}-${member}.png`) });
  }
  if (!repro) {
    const beforeReset = (await completed(page, source)).length;
    await price.fill(String(initialPrice)); await price.press("Enter");
    await expect.poll(async () => (await completed(page, source)).length).toBeGreaterThan(beforeReset);
    await expect(timePick).toBeEnabled();
    // Delay delivery of the actual opaque-frame completion. The worker and
    // payload are untouched; this is the existing editor hold/release pattern.
    await page.evaluate(source => {
      (window as any).__focus137Hold = true; (window as any).__focus137Held = null;
      addEventListener("message", event => {
        const actual = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')]
          .find(frame => frame.contentWindow === event.source && frame.srcdoc.includes(`data-job="${event.data?.nonce}"`));
        if (actual && event.origin === "null" && event.data?.type === "result" && event.data.payload?.status === "completed"
          && event.data.payload.result?.kind === "run" && event.data.payload.result.source === source && (window as any).__focus137Hold) {
          (window as any).__focus137Held = event; event.stopImmediatePropagation();
        }
      }, true);
    }, source);
    await pricePick.click(); await expect(group).toBeVisible();
    const geometry = await coordinate(page, group, pane);
    if (info.project.name === "mobile") await page.touchscreen.tap(geometry.point.x, geometry.point.y);
    else await page.mouse.click(geometry.point.x, geometry.point.y);
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__focus137Held))).toBe(true);
    await expect(close).toBeVisible(); await close.focus(); await page.keyboard.press("ArrowRight"); await expect(close).toBeFocused();
    const held = await page.evaluate(() => {
      (window as any).__focus137Hold = false;
      const event = (window as any).__focus137Held as MessageEvent;
      const result = event.data.payload.result;
      window.dispatchEvent(new MessageEvent("message", { data: event.data, origin: event.origin, source: event.source }));
      (window as any).__focus137Held = null;
      return { inputs: result.inputs, inputDefinitions: result.inputDefinitions };
    });
    expect(held.inputs.in_0).toBeGreaterThan(limit);
    await expect(time).toBeDisabled(); await expect(pricePick).toBeDisabled(); await frame(page); await expect(close).toBeFocused();
    evidence.freshKeyboardFocus = { geometry, heldNativeResult: held, focused: await focused(page) };
  }
  const workerName = fs.readdirSync(path.join(dist, "assets")).find(name => /^pine-native-worker.*\.js$/.test(name))!;
  const bytes = fs.readFileSync(path.join(dist, "assets", workerName));
  expect(state.workerReceipts.length).toBeGreaterThan(0);
  expect(state.workerReceipts.every(receipt => receipt.sha256 === hash(bytes) && receipt.bytes === bytes.length)).toBe(true);
  expect(errors).toEqual([]);
  const folder = path.resolve(".artifacts/pine-input-focus137", repro ? "before-fix" : "final", info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${pane ? "pane" : "main"}.json`), JSON.stringify({ scope: "Actual production app and native worker; API/auth/storage fixtures only", repro,
    workerName, workerSHA256: hash(bytes), workerReceipts: state.workerReceipts, evidence, errors }, null, 2));
});
