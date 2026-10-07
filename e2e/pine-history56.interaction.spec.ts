import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bars as productBars } from "./support/replay-context";
import { productSetup, editor, checkedRun } from "./pine-layering.product-support";

const artifacts = path.resolve(process.env.EDGELAB_PINE_HISTORY_ARTIFACTS ?? ".artifacts/pine-history56/browser");
const title = "Object history";
const source = `//@version=6
indicator("${title}",overlay=true,behind_chart=false)
lookback=input.int(1,"Lookback",minval=0,maxval=3)
shade=input.color(#ff0000,"Shade")
type Cell
    float price = na
method plus(Cell self) =>
    self.price + 5
Cell current = Cell.new(0)
current.price := 67500 + bar_index*2 + 3
Cell copied = current.copy()
Cell previous = copied[math.min(bar_index,lookback)]
plot((current[math.min(bar_index,lookback)]).price,"Direct",color=shade,linewidth=4)
plot(previous.price,"Copied",color=shade,linewidth=4)
plot(previous.plus(),"Method",color=shade,linewidth=4)`;

async function resultFor(page: Page, lookback: number, shade: string) {
  const args = { source, lookback, shade };
  const lookup = ({ source, lookback, shade }: typeof args) => [...(window as any).__layerResults].reverse().find((response: any) =>
    response.status === "completed" && response.result.kind === "run" && response.result.source === source &&
    response.result.inputs.in_0 === lookback && response.result.inputs.in_1 === shade)?.result;
  await expect.poll(() => page.evaluate(lookup, args)).toBeTruthy();
  const result = await page.evaluate(lookup, args);
  expect(result.source).toBe(source);
  expect(result.inputs).toEqual({ in_0: lookback, in_1: shade });
  expect(result.plots.map((plot: any) => plot.name)).toEqual(["Direct", "Copied", "Method"]);
  for (const [name, addend] of [["Direct", 0], ["Copied", 0], ["Method", 5]] as const) {
    const points = result.plots.find((plot: any) => plot.name === name).points;
    expect(points.length).toBeGreaterThan(1);
    for (const point of points) {
      const index = productBars.findIndex((bar) => bar.time === point.time);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(point.value).toBe(67500 + Math.max(0, index - lookback) * 2 + 3 + addend);
    }
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
    let bluePoint: { x: number; y: number } | undefined;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] === 255 && data[index + 1] === 0 && data[index + 2] === 0) red++;
      if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 255) {
        blue++;
        bluePoint ??= { x: (index / 4) % canvas.width, y: Math.floor(index / 4 / canvas.width) };
      }
    }
    const rect = canvas.getBoundingClientRect();
    return { red, blue, width: canvas.width, height: canvas.height, bluePoint: bluePoint ? {
      x: rect.x + bluePoint.x * rect.width / canvas.width,
      y: rect.y + bluePoint.y * rect.height / canvas.height,
    } : null };
  });
}

// The API fixture supplies verified identity, paid entitlement and durable storage;
// the real opaque sandbox and byte-identical production worker execute all Pine.
test("saved direct object-history fields run after reload and real input changes", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const setup = await productSetup(page);
  let dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await checkedRun(dialog);
  const initial = await resultFor(page, 1, "#FF0000FF");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => setup.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === source)).toBe(true);
  const saved = structuredClone(setup.storage.get("custom-indicator-scripts.v1").find((script: any) => script.source === source));
  await page.reload();
  dialog = await editor(page);
  await dialog.getByLabel("Script library", { exact: true }).selectOption(saved.id);
  await expect(dialog.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(source);
  await checkedRun(dialog);
  const reloaded = await resultFor(page, 1, "#FF0000FF");
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const row = page.locator(".native-study-chip").filter({ hasText: title }).first();
  await expect(row).toBeVisible();
  await expect.poll(async () => (await colors(page)).red).toBeGreaterThan(0);
  await row.getByRole("button", { name: `Inputs for ${title}`, exact: true }).click();
  await row.getByRole("spinbutton", { name: "Lookback", exact: true }).fill("0");
  const zeroLookback = await resultFor(page, 0, "#FF0000FF");
  await row.getByRole("spinbutton", { name: "Lookback", exact: true }).fill("2");
  const customLookback = await resultFor(page, 2, "#FF0000FF");
  await row.getByRole("textbox", { name: "Shade", exact: true }).fill("#0000ff");
  const customShade = await resultFor(page, 2, "#0000ff");
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
  fs.writeFileSync(path.join(folder, "saved-object-history.json"), JSON.stringify({ source, initial, reloaded, zeroLookback, customLookback, customShade, saved, workerName, workerSha256, workerBytes: worker.length, workerReceipts: setup.workerReceipts, pixels: await colors(page), errors }, null, 2));
  await row.getByRole("button", { name: `Close inputs for ${title}`, exact: true }).click();
  await page.locator(".chart-stage").first().scrollIntoViewIfNeeded();
  await expect.poll(async () => (await colors(page)).blue).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(folder, "saved-object-history.png") });
  const painted = await colors(page);
  expect(painted.bluePoint).not.toBeNull();
  await page.evaluate((targetY) => window.scrollBy(0, targetY - innerHeight / 2), painted.bluePoint!.y);
  const visible = await colors(page);
  expect(visible.bluePoint!.y).toBeGreaterThan(80);
  expect(visible.bluePoint!.y).toBeLessThan(page.viewportSize()!.height - 80);
  fs.writeFileSync(path.join(folder, "visible-native-geometry.json"), JSON.stringify(visible, null, 2));
  await page.screenshot({ path: path.join(folder, "visible-native-geometry.png") });
});
