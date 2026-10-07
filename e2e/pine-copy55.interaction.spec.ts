import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { productSetup, editor, checkedRun } from "./pine-layering.product-support";

const artifacts = path.resolve(".artifacts/pine-copy55/browser");
const title = "Current object copies";
const source = `//@version=6
indicator("${title}",overlay=true,behind_chart=false)
amount=input.int(9,"Amount",minval=1,maxval=20)
shade=input.color(#ff0000,"Shade")
type Cell
    int count = 0
    array<int> members
method shifted(Cell self,int addend) =>
    self.count + addend
Cell original = Cell.new(0,array.from(1))
original.count := amount
original.members := array.from(2)
Cell member = original.copy()
Cell staticCopy = Cell.copy(original)
plot(67500+member.count+array.get(member.members,0),"Member",color=shade,linewidth=4)
plot(67500+staticCopy.count+array.get(staticCopy.members,0),"Static",color=shade,linewidth=4)
plot(67500+member.shifted(3)+array.get(member.members,0),"Method",color=shade,linewidth=4)`;

async function resultFor(page: Page, amount: number, shade: string) {
  const args = { source, amount, shade };
  const lookup = ({ source, amount, shade }: typeof args) => [...(window as any).__layerResults].reverse().find((response: any) =>
    response.status === "completed" && response.result.kind === "run" && response.result.source === source &&
    response.result.inputs.in_0 === amount && response.result.inputs.in_1 === shade)?.result;
  await expect.poll(() => page.evaluate(lookup, args)).toBeTruthy();
  const result = await page.evaluate(lookup, args);
  expect(result.source).toBe(source);
  expect(result.inputs).toEqual({ in_0: amount, in_1: shade });
  expect(result.plots.map((plot: any) => plot.name)).toEqual(["Member", "Static", "Method"]);
  for (const [name, addend] of [["Member", 0], ["Static", 0], ["Method", 3]] as const) {
    const points = result.plots.find((plot: any) => plot.name === name).points;
    expect(points.length).toBeGreaterThan(1);
    expect(points.every((point: any) => point.value === 67500 + amount + 2 + addend)).toBe(true);
    expect(new Set(points.map((point: any) => point.time)).size).toBe(points.length);
  }
  return result;
}

async function colors(page: Page) {
  return page.locator(".chart-stage").first().evaluate((stage) => {
    const canvas = [...stage.querySelectorAll("canvas")].filter((item) => item.getBoundingClientRect().height > 80).sort((a, b) => b.width - a.width)[0];
    if (!canvas) throw new Error("Actual primary pane canvas missing.");
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let blue = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] === 255 && data[index + 1] === 0 && data[index + 2] === 0) red++;
      if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 255) blue++;
    }
    return { red, blue, width: canvas.width, height: canvas.height };
  });
}

// The API fixture supplies verified identity, paid entitlement and durable storage;
// the real opaque sandbox and byte-identical production worker execute all Pine.
test("saved current-field member and static copies run after reload and real input changes", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const setup = await productSetup(page);
  let dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await checkedRun(dialog);
  const initial = await resultFor(page, 9, "#FF0000FF");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => setup.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === source)).toBe(true);
  const saved = structuredClone(setup.storage.get("custom-indicator-scripts.v1").find((script: any) => script.source === source));
  await page.reload();
  dialog = await editor(page);
  await dialog.getByLabel("Script library", { exact: true }).selectOption(saved.id);
  await expect(dialog.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(source);
  await checkedRun(dialog);
  const reloaded = await resultFor(page, 9, "#FF0000FF");
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const row = page.locator(".native-study-chip").filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  await expect.poll(async () => (await colors(page)).red).toBeGreaterThan(0);
  await row.getByRole("button", { name: `Inputs for ${title}`, exact: true }).click();
  await row.getByRole("spinbutton", { name: "Amount", exact: true }).fill("12");
  const customAmount = await resultFor(page, 12, "#FF0000FF");
  await row.getByRole("textbox", { name: "Shade", exact: true }).fill("#0000ff");
  const customShade = await resultFor(page, 12, "#0000ff");
  await expect.poll(async () => (await colors(page)).blue).toBeGreaterThan(0);
  expect(setup.storage.get("custom-indicator-scripts.v1").find((script: any) => script.id === saved.id)).toEqual(saved);
  const workerName = fs.readdirSync("frontend/dist/assets").find((name) => /^pine-native-worker.*\.js$/.test(name))!;
  const worker = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  expect(setup.workerReceipts.length).toBeGreaterThan(0);
  for (const receipt of setup.workerReceipts) {
    expect(receipt.sha256).toBe(workerSha256);
    expect(receipt.bytes).toBe(worker.length);
  }
  expect(errors).toEqual([]);
  const folder = path.join(artifacts, info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "saved-current-copies.json"), JSON.stringify({ source, initial, reloaded, customAmount, customShade, saved, workerName, workerSha256, workerBytes: worker.length, workerReceipts: setup.workerReceipts, pixels: await colors(page), errors }, null, 2));
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(folder, "saved-current-copies.png") });
});
