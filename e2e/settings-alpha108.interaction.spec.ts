import { test as base, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.EDGELAB_ALPHA108_PORT ?? 45308);
type Harness = { origin: string };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const bundle = await build({ entryPoints: [path.join(root, "e2e/settings-alpha108.fixture.tsx")], bundle: true,
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
const field = (page: Page, label = "Drawing") => page.getByRole("textbox", { name: label + " hex code", exact: true });
const owner = (page: Page, mode: "alpha" | "strict" = "alpha") => page.getByTestId(mode + "-owner");
const external = (page: Page, color: string, mode: "alpha" | "strict" = "alpha") => page.evaluate(({ mode, color }) => window.alphaFixture.external(mode, color), { mode, color });
const ledger = (page: Page, mode: "alpha" | "strict" = "alpha") => page.evaluate(mode => window.alphaFixture.ledger(mode), mode);
async function start(page: Page, harness: Harness) {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(harness.origin); await expect(field(page)).toHaveValue("#FF000080"); return errors;
}
async function palette(page: Page, label = "Drawing") {
  await page.getByRole("button", { name: label + " palette", exact: true }).click();
  const popup = page.getByRole("dialog", { name: new RegExp("^" + label + " #") });
  await expect(popup).toBeVisible(); await expect(popup.getByRole("textbox", { name: label + " selected color hex code", exact: true })).toBeFocused(); return popup;
}
test("alpha hex retains incoming opacity and own typing caret while explicit RGBA and owner updates win", async ({ page, harness }) => {
  const errors = await start(page, harness);
  await expect(field(page)).toHaveAttribute("maxlength", "9");
  const displayed = await page.getByRole("button", { name: "Drawing palette", exact: true }).locator("span").evaluate(node => getComputedStyle(node).backgroundColor);
  expect(await page.evaluate(color => window.alphaFixture.paint(color, 1).pixel, displayed)).toEqual([255, 0, 0, 128]);
  await field(page).fill("#112233");
  await expect(owner(page)).toHaveText("#11223380"); await expect(field(page)).toHaveValue("#112233"); await expect(field(page)).toBeFocused();
  await field(page).evaluate((node: HTMLInputElement) => node.setSelectionRange(3, 4));
  await field(page).press("A"); await expect(owner(page)).toHaveText("#11A23380");
  expect(await field(page).evaluate((node: HTMLInputElement) => [node.selectionStart, node.selectionEnd])).toEqual([4, 4]);
  await field(page).fill("#abc"); await expect(field(page)).toHaveAttribute("aria-invalid", "true");
  await field(page).press("Enter"); await expect(owner(page)).toHaveText("#AABBCC80"); await expect(field(page)).toHaveValue("#AABBCC80");
  await field(page).fill("#01020300"); await expect(owner(page)).toHaveText("#01020300");
  await field(page).fill("#GG"); const count = (await ledger(page)).length;
  await external(page, "#44556640"); await expect(field(page)).toHaveValue("#44556640"); await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveAttribute("aria-invalid", "false"); expect((await ledger(page)).length).toBe(count);
  await page.getByRole("button", { name: "Outside focus target", exact: true }).click();
  expect((await ledger(page)).slice(count).every(value => value === "#44556640")).toBe(true);
  expect(errors).toEqual([]);
});
test("RGB and swatch changes preserve alpha while explicit opacity can reach transparent and opaque endpoints", async ({ page, harness }) => {
  const errors = await start(page, harness); let popup = await palette(page);
  const hex = page.getByRole("textbox", { name: "Drawing selected color hex code", exact: true });
  await expect(hex).toHaveAttribute("maxlength", "9");
  await popup.getByRole("slider", { name: "Red", exact: true }).focus(); await page.keyboard.press("Home");
  await expect(owner(page)).toHaveText("#00000080");
  await page.keyboard.press("End"); await expect(owner(page)).toHaveText("#FF000080");
  await popup.getByRole("button", { name: "Use #32D3EE", exact: true }).click(); await expect(owner(page)).toHaveText("#32D3EE80");
  popup = await palette(page);
  await expect(popup.getByRole("button", { name: "Use #32D3EE", exact: true })).toHaveAttribute("aria-current", "true");
  const opacity = popup.getByRole("slider", { name: "Drawing opacity", exact: true });
  await expect(opacity).toHaveValue("128"); await expect(opacity).toHaveAttribute("aria-valuetext", "50% opacity");
  await opacity.focus(); await page.keyboard.press("Home"); await expect(owner(page)).toHaveText("#32D3EE00");
  await expect(opacity).toHaveAttribute("aria-valuetext", "0% opacity");
  await page.keyboard.press("End"); await expect(owner(page)).toHaveText("#32D3EEFF"); await expect(opacity).toHaveAttribute("aria-valuetext", "100% opacity");
  await hex.fill("#ABCD1234"); await expect(owner(page)).toHaveText("#ABCD1234");
  await hex.fill("#GG"); const count = (await ledger(page)).length;
  await external(page, "#77889920"); await expect(hex).toHaveValue("#77889920"); await expect(hex).toBeFocused();
  await expect(hex).toHaveAttribute("aria-invalid", "false"); expect((await ledger(page)).length).toBe(count);
  await hex.press("Escape"); await expect(popup).toBeHidden(); await expect(page.getByRole("button", { name: "Drawing palette", exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
test("new RGB colors remain six digits and strict chart colors do not opt into alpha", async ({ page, harness }) => {
  const errors = await start(page, harness);
  await external(page, "#123456"); await field(page).fill("#AABBCC"); await expect(owner(page)).toHaveText("#AABBCC");
  let popup = await palette(page); await popup.getByRole("button", { name: "Use #22C55E", exact: true }).click();
  await expect(owner(page)).toHaveText("#22C55E");
  popup = await palette(page); await popup.getByRole("slider", { name: "Drawing opacity", exact: true }).focus(); await page.keyboard.press("Home");
  await expect(owner(page)).toHaveText("#22C55E00"); await page.keyboard.press("Escape");
  await expect(field(page, "Chart")).toHaveAttribute("maxlength", "7");
  await external(page, "#FF000080", "strict"); await expect(field(page, "Chart")).toHaveValue("#32D3EE"); expect(await ledger(page, "strict")).toEqual([]);
  const strictPopup = await palette(page, "Chart"); await expect(strictPopup.getByRole("slider", { name: "Chart opacity", exact: true })).toHaveCount(0);
  await strictPopup.getByRole("textbox", { name: "Chart selected color hex code", exact: true }).fill("#102030");
  await expect(owner(page, "strict")).toHaveText("#102030"); expect((await ledger(page, "strict")).every(color => /^#[0-9A-F]{6}$/.test(color))).toBe(true);
  expect(errors).toEqual([]);
});
test("the actual renderer composes stored alpha with fill opacity instead of replacing it", async ({ page, harness }) => {
  const errors = await start(page, harness);
  const paints = await page.evaluate(() => [["#FF000080", .2], ["#FF000000", .9], ["#FF0000", .2], ["#F00", .2], ["#FF000080", 2], ["#FF000080", -1]].map(([color, opacity]) => window.alphaFixture.paint(color as string, opacity as number)));
  expect(paints.map(value => value.pixel[3])).toEqual([26, 0, 51, 51, 128, 0]);
  expect(paints[0].pixel.slice(0, 3)).toEqual([255, 0, 0]); expect(errors).toEqual([]);
});
test("alpha palette remains themed and contained and disabled state discards unfinished drafts", async ({ page, harness }, info) => {
  const errors = await start(page, harness); const popup = await palette(page);
  const receipt = await popup.evaluate(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    const probe = document.createElement("span"); probe.style.backgroundColor = "var(--ui-floating)"; probe.style.color = "var(--text-primary)";
    document.body.append(probe); const expected = getComputedStyle(probe); const background = expected.backgroundColor, color = expected.color; probe.remove();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, background: style.backgroundColor, color: style.color, expectedBackground: background, expectedColor: color };
  });
  expect(receipt.x).toBeGreaterThanOrEqual(0); expect(receipt.y).toBeGreaterThanOrEqual(0); expect(receipt.right).toBeLessThanOrEqual(receipt.width + 1); expect(receipt.bottom).toBeLessThanOrEqual(receipt.height + 1);
  expect(receipt.background).toBe(receipt.expectedBackground); expect(receipt.color).toBe(receipt.expectedColor);
  await expect.poll(() => popup.evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  if (process.env.EDGELAB_ALPHA108_CAPTURE !== "0") {
    const dir = path.join(root, ".artifacts/settings-alpha108"); fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, "final-" + info.project.name + ".png"), animations: "disabled" });
    fs.writeFileSync(path.join(dir, "final-" + info.project.name + ".json"), JSON.stringify(receipt, null, 2));
  }
  await page.getByRole("textbox", { name: "Drawing selected color hex code", exact: true }).fill("#GG");
  await page.evaluate(() => window.alphaFixture.disable(true)); await expect(popup).toBeHidden(); await expect(field(page)).toBeDisabled(); await expect(field(page)).toHaveValue("#FF000080");
  expect(await ledger(page)).toEqual([]);
  await external(page, "#01020300"); await expect(field(page)).toHaveValue("#01020300"); await page.evaluate(() => window.alphaFixture.disable(false));
  await expect(field(page)).toBeEnabled(); await expect(field(page)).toHaveAttribute("aria-invalid", "false"); expect(errors).toEqual([]);
});
