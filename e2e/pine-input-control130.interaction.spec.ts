import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "frontend/dist");
const hash = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
function inventory(dir = dist): { file: string; sha256: string }[] {
  return fs.readdirSync(dir).sort().flatMap(name => {
    const full = path.join(dir, name);
    return fs.statSync(full).isDirectory() ? inventory(full) : [{ file: path.relative(dist, full), sha256: hash(fs.readFileSync(full)) }];
  });
}
const before = inventory();
const css = fs.readFileSync(path.join(dist, "index.html"), "utf8").match(/href="([^"]+\.css)"/)![1];
let server: http.Server;
const observations: unknown[] = [];
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.join(root, "e2e/pine-input-control130.fixture.tsx")], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  server = http.createServer((request, response) => {
    const url = new URL(request.url!, "http://127.0.0.1").pathname;
    if (url === "/") { response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`); return; }
    if (url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(result.outputFiles[0].contents); return; }
    const full = path.resolve(dist, `.${url}`);
    if (full.startsWith(dist + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile()) { response.setHeader("Content-Type", url.endsWith(".css") ? "text/css" : url.endsWith(".woff2") ? "font/woff2" : "application/octet-stream"); response.end(fs.readFileSync(full)); return; }
    response.writeHead(404); response.end();
  });
  await new Promise<void>(resolve => server.listen(45332, "127.0.0.1", resolve));
});
test.afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  expect(inventory()).toEqual(before);
  const receipt = { probe: "Actual PineInputControl component plus strict prepare metadata protocol only; no Pine execution", sealedParentDistSHA: "79296f7388990152b71be351d66d33f603865108911acdb5d6164feea9935254", files: before.length, unchanged: true, inventorySHA256: hash(JSON.stringify(before)), css: { path: css, sha256: hash(fs.readFileSync(path.join(dist, css))) }, sources: ["frontend/src/components/PineInputControl.tsx", "frontend/src/components/ThemedSelect.tsx", "frontend/src/lib/pineProtocol.ts"].map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) })), observations };
  fs.mkdirSync(path.join(root, ".artifacts"), { recursive: true });
  fs.writeFileSync(path.join(root, `.artifacts/pine-input-control130-${test.info().project.name}-receipt.json`), JSON.stringify(receipt, null, 2));
});
async function probe(page: Page, operation: string, ...args: unknown[]) {
  return page.evaluate(({ operation, args }) => (window as any).inputProbe[operation](...args), { operation, args });
}
async function ledger(page: Page) { return page.evaluate(() => (window as any).inputProbe.emissions); }

test("actual input identity, null recovery, enum IDs, disabled gating, semantic palette and whole-label touch target", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:45332/");
  await expect(page.getByRole("combobox", { name: "Mixed scalars" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).inputProbe.definitions[1].options)).toEqual([1, "1", true, "true", null]);
  expect(await probe(page, "rejectDuplicateEnumIds")).toBe(true);
  const combo = page.getByRole("combobox", { name: "Mixed scalars" });
  for (const index of [1, 0, 2, 3]) {
    await combo.click(); const options = page.getByRole("option");
    expect(new Set(await options.evaluateAll(elements => elements.map(element => element.id))).size).toBe(5);
    await options.nth(index).click();
    await combo.click(); await expect(page.getByRole("option").nth(index)).toHaveAttribute("aria-selected", "true"); await page.keyboard.press("Escape");
  }
  const scalars = await ledger(page);
  expect(scalars).toEqual([{ id: "in_1", value: "1", type: "string" }, { id: "in_1", value: 1, type: "number" }, { id: "in_1", value: true, type: "boolean" }, { id: "in_1", value: "true", type: "string" }]);
  await combo.click(); const nullOption = page.getByRole("option").nth(4);
  await expect(nullOption).toBeDisabled(); await expect(nullOption).toHaveAttribute("aria-disabled", "true");
  const nullRect = await nullOption.boundingBox(); await page.mouse.click(nullRect!.x + nullRect!.width / 2, nullRect!.y + nullRect!.height / 2);
  expect(await ledger(page)).toEqual(scalars); await page.keyboard.press("Escape");
  await probe(page, "mount", ["in_2"]);
  const nullCombo = page.getByRole("combobox", { name: "Null choice" });
  await expect(nullCombo).toHaveText("Choose a valid option"); await expect(nullCombo).toHaveAttribute("aria-invalid", "true"); expect(await ledger(page)).toEqual([]);
  await probe(page, "set", "in_2", "missing"); await probe(page, "recovery", "in_2", "Old saved choice");
  await expect(nullCombo).toHaveAccessibleDescription('Saved choice “Old saved choice” needs reselection. Choose a valid option.');
  await expect(page.getByRole("alert")).toBeVisible();
  await nullCombo.click(); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  expect(await ledger(page)).toEqual([{ id: "in_2", value: "true", type: "string" }]);
  await expect(nullCombo).toHaveAttribute("aria-invalid", "false"); await expect(nullCombo).not.toHaveAttribute("aria-describedby", /.+/); await expect(page.getByRole("alert")).toHaveCount(0);
  await probe(page, "mount", ["in_3"]); const enumCombo = page.getByRole("combobox", { name: "Enum choices" });
  await enumCombo.click(); const enumOptions = page.getByRole("option", { name: "Same label" }); await expect(enumOptions).toHaveCount(2);
  const enumIds = await enumOptions.evaluateAll(elements => elements.map(element => element.id)); expect(enumIds[0]).not.toBe(enumIds[1]); await enumOptions.nth(1).click();
  await enumCombo.click(); await expect(page.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true"); await page.getByRole("option").nth(0).click();
  expect(await ledger(page)).toEqual([{ id: "in_3", value: "Mode.second", type: "string" }, { id: "in_3", value: "Mode.first", type: "string" }]);
  await probe(page, "mount", ["in_0", "in_4", "in_5", "in_6", "in_7"]);
  const gate = page.getByRole("checkbox", { name: "Gate", exact: true });
  const gatedChoice = page.getByRole("combobox", { name: "Conditional choice" });
  const gatedBool = page.getByRole("checkbox", { name: "Conditional checkbox" });
  await expect(gatedChoice).toBeDisabled(); await expect(gatedBool).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Disabled choice" })).toBeDisabled(); await expect(page.getByRole("checkbox", { name: "Disabled checkbox" })).toBeDisabled();
  const label = gate.locator(".."); const hit = await label.boundingBox(); const checkbox = await gate.boundingBox();
  expect(hit!.height).toBeGreaterThanOrEqual(44); expect(hit!.width).toBeGreaterThan(checkbox!.width * 5);
  const labelClick = async (rect: NonNullable<typeof hit>) => info.project.name === "mobile" ? page.touchscreen.tap(rect.x + rect.width - 12, rect.y + rect.height / 2) : page.mouse.click(rect.x + rect.width - 12, rect.y + rect.height / 2);
  await labelClick(hit!); await expect(gate).toBeChecked(); await expect(gatedChoice).toBeEnabled(); await expect(gatedBool).toBeEnabled();
  await gatedChoice.click(); await expect(page.getByRole("listbox")).toBeVisible();
  await probe(page, "set", "in_0", false); await expect(gatedChoice).toBeDisabled(); await expect(page.getByRole("listbox")).toHaveCount(0);
  const disabledRect = await gatedBool.locator("..").boundingBox(); await labelClick(disabledRect!);
  expect(await ledger(page)).toEqual([{ id: "in_0", value: true, type: "boolean" }]);
  await probe(page, "mount", ["in_1", "in_0"]);
  const colors: unknown[] = [];
  for (const palette of ["dark", "light"]) {
    await probe(page, "palette", palette); await combo.click();
    // Theme changes animate the trigger color. Observe its settled computed
    // value, rather than comparing an intermediate interpolation to a token.
    await expect.poll(() => combo.evaluate(element => {
      const sample = document.createElement("span"); sample.style.color = "var(--text-primary)"; document.body.append(sample);
      const expected = getComputedStyle(sample).color; sample.remove();
      return getComputedStyle(element).color === expected;
    })).toBe(true);
    const measured = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement), menu = getComputedStyle(document.querySelector('[role="listbox"]')!), trigger = getComputedStyle(document.querySelector('[role="combobox"]')!);
      const rgb = (token: string) => { const element = document.createElement("span"); element.style.color = root.getPropertyValue(token); document.body.append(element); const value = getComputedStyle(element).color; element.remove(); return value; };
      return { menu: menu.backgroundColor, text: menu.color, floating: rgb("--ui-floating"), primary: rgb("--text-primary"), trigger: trigger.color };
    });
    expect(measured.menu).toBe(measured.floating); expect(measured.text).toBe(measured.primary); expect(measured.trigger).toBe(measured.primary); colors.push(measured);
    await page.keyboard.press("Escape");
  }
  expect((colors[0] as any).menu).not.toBe((colors[1] as any).menu);
  expect(errors).toEqual([]);
  observations.push({ project: info.project.name, scalars, enumIds, labelHit: hit, checkbox, colors, pageErrors: errors });
});
