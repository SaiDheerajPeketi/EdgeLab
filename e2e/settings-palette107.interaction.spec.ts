import { test as base, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.EDGELAB_PALETTE107_PORT ?? 45307);
type Harness = { origin: string };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const bundle = await build({ entryPoints: [path.join(root, "e2e/settings-palette107.fixture.tsx")], bundle: true,
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
const input = (page: Page) => page.getByRole("textbox", { name: "Accent hex code", exact: true });
const owner = (page: Page) => page.getByTestId("owner-color");
const ledger = (page: Page) => page.evaluate(() => window.colorFixture.ledger());
const external = (page: Page, color: string) => page.evaluate(value => window.colorFixture.external(value), color);
async function blurOutside(page: Page) {
  const button = page.getByRole("button", { name: "Outside focus target", exact: true });
  expect(await button.evaluate(element => { const rect = element.getBoundingClientRect(); const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return target === element || Boolean(target && element.contains(target)); })).toBe(true);
  await button.click();
}
async function open(page: Page, harness: Harness) {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(harness.origin); await expect(input(page)).toHaveValue("#102030");
  return errors;
}


for (const popup of [false, true]) test((popup ? "popup" : "inline") + " incoming colors replace focused valid and invalid drafts without replaying stale callbacks", async ({ page, harness }) => {
  const errors = await open(page, harness);
  const chooseField = async () => {
    if (!popup) return input(page);
    await page.getByRole("button", { name: "Accent palette", exact: true }).click();
    const field = page.getByRole("textbox", { name: "Accent selected color hex code", exact: true });
    await expect(field).toBeFocused(); return field;
  };
  let field = await chooseField();
  await field.fill("#112233"); await expect(owner(page)).toHaveText("#112233");
  expect(await ledger(page)).toEqual(["#112233"]);
  await external(page, "#445566");
  await expect(owner(page)).toHaveText("#445566"); await expect(field).toHaveValue("#445566");
  await expect(field).toBeFocused(); await expect(field).toHaveAttribute("aria-invalid", "false");
  const validCount = (await ledger(page)).length;
  await blurOutside(page);
  await expect(owner(page)).toHaveText("#445566");
  expect((await ledger(page)).slice(validCount).every(value => value === "#445566")).toBe(true);
  field = await chooseField(); await field.fill("#GG");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const invalidCount = (await ledger(page)).length;
  await external(page, "#778899");
  await expect(owner(page)).toHaveText("#778899"); await expect(field).toHaveValue("#778899");
  await expect(field).toBeFocused(); await expect(field).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await blurOutside(page);
  await expect(owner(page)).toHaveText("#778899");
  expect((await ledger(page)).slice(invalidCount).every(value => value === "#778899")).toBe(true);
  field = await chooseField();
  const shorthandCount = (await ledger(page)).length;
  await field.fill("#ABC"); await expect(field).toHaveAttribute("aria-invalid", "true");
  expect((await ledger(page)).length).toBe(shorthandCount);
  await external(page, "#AABBCC");
  await expect(owner(page)).toHaveText("#AABBCC"); await expect(field).toHaveValue("#AABBCC");
  await expect(field).toBeFocused(); await expect(field).toHaveAttribute("aria-invalid", "false");
  expect((await ledger(page)).length).toBe(shorthandCount);
  await blurOutside(page); await expect(owner(page)).toHaveText("#AABBCC");
  expect((await ledger(page)).slice(shorthandCount).every(value => value === "#AABBCC")).toBe(true);
  expect(errors).toEqual([]);
});

test("own valid typing preserves focus and the selection caret through the controlled acknowledgment", async ({ page, harness }) => {
  const errors = await open(page, harness);
  await external(page, "#123456"); await expect(input(page)).toHaveValue("#123456");
  await input(page).focus();
  await input(page).evaluate((element: HTMLInputElement) => element.setSelectionRange(3, 4));
  await input(page).press("A");
  await expect(input(page)).toHaveValue("#12A456"); await expect(owner(page)).toHaveText("#12A456");
  await expect(input(page)).toBeFocused();
  expect(await input(page).evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([4, 4]);
  expect(await ledger(page)).toEqual(["#12A456"]); expect(errors).toEqual([]);
});

test("shorthand Enter commits while ordinary invalid blur preserves the owner and Escape restores recovery", async ({ page, harness }) => {
  const errors = await open(page, harness);
  await input(page).fill("#abc"); expect(await ledger(page)).toEqual([]);
  await input(page).press("Enter");
  await expect(owner(page)).toHaveText("#AABBCC"); await expect(input(page)).toHaveValue("#AABBCC");
  await expect(input(page)).toHaveAttribute("aria-invalid", "false"); expect(await ledger(page)).toEqual(["#AABBCC"]);
  await input(page).fill("#GG"); await blurOutside(page);
  await expect(owner(page)).toHaveText("#AABBCC"); await expect(input(page)).toHaveValue("#GG");
  await expect(input(page)).toHaveAttribute("aria-invalid", "true"); await expect(page.getByRole("alert")).toBeVisible();
  expect(await ledger(page)).toEqual(["#AABBCC"]);
  await input(page).focus(); await input(page).press("Escape");
  await expect(input(page)).toHaveValue("#AABBCC"); await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await ledger(page)).toEqual(["#AABBCC"]); expect(errors).toEqual([]);
});

test("disabled state closes the actual palette and resets unfinished drafts without a stale callback", async ({ page, harness }) => {
  const errors = await open(page, harness);
  await page.getByRole("button", { name: "Accent palette", exact: true }).click();
  const popup = page.getByRole("dialog", { name: /^Accent #/ });
  const field = page.getByRole("textbox", { name: "Accent selected color hex code", exact: true });
  await expect(field).toBeFocused(); await field.fill("#GG");
  await page.evaluate(() => window.colorFixture.disable(true));
  await expect(popup).toBeHidden(); await expect(input(page)).toBeDisabled();
  await expect(input(page)).toHaveValue("#102030"); await expect(page.getByRole("button", { name: "Accent palette", exact: true })).toBeDisabled();
  expect(await ledger(page)).toEqual([]);
  await external(page, "#778899"); await expect(input(page)).toHaveValue("#778899");
  await page.evaluate(() => window.colorFixture.disable(false));
  await expect(input(page)).toBeEnabled(); await expect(input(page)).toHaveAttribute("aria-invalid", "false");
  expect(await ledger(page)).toEqual([]); expect(errors).toEqual([]);
});

test("actual palette follows surface tokens stays within the viewport and dismisses by keyboard", async ({ page, harness }, info) => {
  const errors = await open(page, harness);
  const trigger = page.getByRole("button", { name: "Accent palette", exact: true });
  await trigger.click();
  const popup = page.getByRole("dialog", { name: /^Accent #/ });
  const field = page.getByRole("textbox", { name: "Accent selected color hex code", exact: true });
  await expect(field).toBeFocused();
  const receipt = await popup.evaluate((element: HTMLElement) => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    const token = (property: string, cssProperty: "color" | "backgroundColor") => {
      const node = document.createElement("span"); node.style[cssProperty] = "var(" + property + ")";
      document.body.append(node); const value = getComputedStyle(node)[cssProperty]; node.remove(); return value;
    };
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, viewport: { width: innerWidth, height: innerHeight },
      background: style.backgroundColor, color: style.color, expectedBackground: token("--ui-floating", "backgroundColor"),
      expectedColor: token("--text-primary", "color") };
  });
  expect(receipt.x).toBeGreaterThanOrEqual(0); expect(receipt.y).toBeGreaterThanOrEqual(0);
  expect(receipt.right).toBeLessThanOrEqual(receipt.viewport.width + 1); expect(receipt.bottom).toBeLessThanOrEqual(receipt.viewport.height + 1);
  expect(receipt.background).toBe(receipt.expectedBackground); expect(receipt.color).toBe(receipt.expectedColor);
  await expect.poll(() => popup.evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  const directory = path.join(root, ".artifacts/settings-palette107"); fs.mkdirSync(directory, { recursive: true });
  if (process.env.EDGELAB_PALETTE107_CAPTURE !== "0") {
    await page.screenshot({ path: path.join(directory, "final-" + info.project.name + ".png"), animations: "disabled" });
    fs.writeFileSync(path.join(directory, "final-" + info.project.name + ".json"), JSON.stringify(receipt, null, 2));
  }
  await field.press("Escape"); await expect(popup).toBeHidden(); await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});
