import { test, expect, type Page, type Locator } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { productSetup, editor, checkedRun } from "./pine-layering.product-support";
import { bars } from "./support/replay-context";

const artifacts = path.resolve(".artifacts/pine-strategy64/browser");
const title = "Trader assumptions";
const source = `//@version=6
strategy("${title}",overlay=true,initial_capital=1000000,default_qty_type=strategy.fixed,default_qty_value=1)
if bar_index==1
    strategy.entry("L",strategy.long)
if bar_index==3
    strategy.close("L")
plot(close+strategy.position_size*20,"Position effect",color=#ff0000,linewidth=4)
plot(strategy.position_size,"Position",display=display.none)`;
const settings = {
  initial_capital: 2000000,
  default_qty_type: "fixed",
  default_qty_value: 3,
  commission_type: "cash_per_order",
  commission_value: 2,
  slippage: 0,
  pyramiding: 2,
  process_orders_on_close: true,
};

async function resultFor(page: Page, size: number, close: boolean, capital: number, fee: number, after = 0) {
  const lookup = ({ size, close, capital, fee, after, source }: any) => (window as any).__layerResults.slice(after).reverse().find((response: any) =>
    response.status === "completed" && response.result.kind === "run" && response.result.source === source &&
    response.result.strategy?.config.default_qty_value === size && (response.result.strategy.config.process_orders_on_close ?? false) === close &&
    response.result.strategy.config.initial_capital === capital && response.result.strategy.config.commission_value === fee)?.result;
  const args = { size, close, capital, fee, after, source };
  await expect.poll(() => page.evaluate(lookup, args)).toBeTruthy();
  const result = await page.evaluate(lookup, args);
  expect(result.source).toBe(source);
  expect(result.declaration).toBe("strategy");
  expect(result.strategy.closedTrades).toHaveLength(1);
  const trade = result.strategy.closedTrades[0];
  const entryIndex = close ? 1 : 2;
  const exitIndex = close ? 3 : 4;
  const entry = close ? bars[entryIndex].close : bars[entryIndex].open;
  const exit = close ? bars[exitIndex].close : bars[exitIndex].open;
  expect(trade.entry_time).toBe(bars[entryIndex].time);
  expect(trade.exit_time).toBe(bars[exitIndex].time);
  expect(trade.entry_price).toBeCloseTo(entry, 8);
  expect(trade.exit_price).toBeCloseTo(exit, 8);
  expect(trade.size).toBe(size);
  expect(trade.commission).toBe(fee * 2);
  const profit = (exit - entry) * size - fee * 2;
  expect(trade.profit).toBeCloseTo(profit, 8);
  expect(result.strategy.metrics.netprofit).toBeCloseTo(profit, 8);
  expect(result.strategy.metrics.equity).toBeCloseTo(capital + profit, 8);
  const position = result.plots.find((plot: any) => plot.name === "Position").points;
  expect(position.slice(0, 6).map((point: any) => point.value)).toEqual([0, 0, size, size, 0, 0]);
  expect(position.map((point: any) => point.time)).toEqual(bars.slice(0, position.length).map((bar) => bar.time));
  return result;
}

const responseCount = (page: Page) => page.evaluate(() => (window as any).__layerResults.length);

async function disclosure(scope: Locator) {
  const summary = scope.locator("summary").filter({ hasText: /^Strategy test settings$/ });
  await summary.scrollIntoViewIfNeeded();
  if (!await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
  return summary.locator("..");
}

function instances(value: any): any[] {
  if (!value || typeof value !== "object") return [];
  const own = value.customScriptSource === source ? [value] : [];
  return own.concat(Object.values(value).flatMap(instances));
}

async function redPixels(page: Page) {
  return page.locator(".chart-stage").first().evaluate((stage) => {
    const canvas = [...stage.querySelectorAll("canvas")].filter((item) => item.getBoundingClientRect().height > 80).sort((a, b) => b.width - a.width)[0];
    if (!canvas) throw new Error("Primary pane canvas missing.");
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] === 255 && data[index + 1] === 0 && data[index + 2] === 0) red++;
    return { red, width: canvas.width, height: canvas.height };
  });
}

// Only identity, entitlement, replay data and durable HTTP storage are fixtures.
// Every prepare/run/chart calculation comes from the real opaque production worker.
test("trader settings persist through editor save and reload while chart overrides remain independent", async ({ page }, info) => {
  test.setTimeout(150000);
  page.setDefaultTimeout(20000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const setup = await productSetup(page);
  let dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-strategy");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await checkedRun(dialog);
  const original = await resultFor(page, 1, false, 1000000, 0);
  console.info("STRATEGY64_CHECKPOINT Editor default ledger verified");
  let controls = await disclosure(dialog);
  await controls.getByRole("spinbutton", { name: "Starting capital", exact: true }).fill("2000000");
  await expect(dialog.getByRole("region", { name: "Pine strategy results", exact: true })).toHaveCount(0);
  await controls.getByRole("spinbutton", { name: "Order size", exact: true }).fill("0");
  await expect(controls.getByRole("spinbutton", { name: "Order size", exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(controls.getByRole("alert")).toContainText("greater than 0");
  await expect(dialog.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await controls.getByRole("spinbutton", { name: "Order size", exact: true }).fill("3");
  await controls.getByRole("combobox", { name: "Position sizing", exact: true }).click();
  await page.getByRole("option", { name: "Contracts or units", exact: true }).click();
  await controls.getByRole("combobox", { name: "Commission type", exact: true }).click();
  await page.getByRole("option", { name: "Per order", exact: true }).click();
  await controls.getByRole("spinbutton", { name: "Commission", exact: true }).fill("2");
  await controls.getByRole("spinbutton", { name: "Slippage (ticks)", exact: true }).fill("0");
  await controls.getByRole("spinbutton", { name: "Entries in same direction", exact: true }).fill("2");
  await controls.getByRole("combobox", { name: "Market order timing", exact: true }).click();
  await page.getByRole("option", { name: "Candle close", exact: true }).click();
  for (const control of await controls.locator("input,select,button").all()) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  const beforeRun = await responseCount(page);
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  const edited = await resultFor(page, 3, true, 2000000, 2, beforeRun);
  console.info("STRATEGY64_CHECKPOINT Edited ledger and all8 settings verified");
  const results = dialog.getByRole("region", { name: "Pine strategy results", exact: true });
  await expect(results).toBeVisible();
  await expect(results.getByLabel("Test assumptions", { exact: true })).toContainText("3 units");
  await expect(results.getByLabel("Closed trades ledger", { exact: true })).toContainText("L");
  const folder = path.join(artifacts, info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  await results.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(folder, "editor-ledger.png") });
  await controls.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(folder, "editor-settings.png") });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => setup.storage.get("custom-indicator-scripts.v1")?.find((script: any) => script.source === source)?.strategySettings).toEqual(settings);
  const saved = structuredClone(setup.storage.get("custom-indicator-scripts.v1").find((script: any) => script.source === source));
  await page.reload();
  dialog = await editor(page);
  await dialog.getByLabel("Script library", { exact: true }).selectOption(saved.id);
  await expect(dialog.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(source);
  controls = await disclosure(dialog);
  await expect(controls.getByRole("spinbutton", { name: "Starting capital", exact: true })).toHaveValue("2000000");
  await expect(controls.getByRole("spinbutton", { name: "Order size", exact: true })).toHaveValue("3");
  await expect(controls.getByRole("combobox", { name: "Market order timing", exact: true })).toContainText("Candle close");
  const beforeReloadedRun = await responseCount(page);
  await checkedRun(dialog);
  const reloaded = await resultFor(page, 3, true, 2000000, 2, beforeReloadedRun);
  console.info("STRATEGY64_CHECKPOINT Saved library reload verified");
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  await page.getByRole("button", { name: "Save Layout", exact: true }).click();
  await expect.poll(() => [...setup.storage.values()].flatMap(instances).find((instance) => instance.customScriptId === saved.id)?.settings.pineStrategySettings).toEqual(settings);
  await expect.poll(async () => (await redPixels(page)).red).toBeGreaterThan(0);
  const beforeChartEdit = await responseCount(page);
  await page.locator("button[data-indicator-id]").filter({ hasText: title }).first().click();
  let toolbar = page.getByRole("group", { name: "Indicator settings", exact: true });
  controls = await disclosure(toolbar);
  await controls.getByRole("spinbutton", { name: "Order size", exact: true }).fill("5");
  const chartEdited = await resultFor(page, 5, true, 2000000, 2, beforeChartEdit);
  expect(setup.storage.get("custom-indicator-scripts.v1").find((script: any) => script.id === saved.id)).toEqual(saved);
  await expect.poll(() => [...setup.storage.values()].flatMap(instances).some((instance) => instance.settings.pineStrategySettings?.default_qty_value === 5)).toBe(true);
  await page.reload();
  const chartReloaded = await resultFor(page, 5, true, 2000000, 2);
  console.info("STRATEGY64_CHECKPOINT Independent chart-layout reload verified");
  await page.locator("button[data-indicator-id]").filter({ hasText: title }).first().click();
  toolbar = page.getByRole("group", { name: "Indicator settings", exact: true });
  controls = await disclosure(toolbar);
  await expect(controls.getByRole("spinbutton", { name: "Order size", exact: true })).toHaveValue("5");
  const beforeReset = await responseCount(page);
  await controls.getByRole("button", { name: "Use script defaults", exact: true }).click();
  const reset = await resultFor(page, 1, false, 1000000, 0, beforeReset);
  console.info("STRATEGY64_CHECKPOINT Chart reset to authored defaults verified");
  await expect(controls.getByRole("spinbutton", { name: "Order size", exact: true })).toHaveValue("");
  await toolbar.getByRole("button", { name: "Close indicator settings", exact: true }).click();
  expect(setup.storage.get("custom-indicator-scripts.v1").find((script: any) => script.id === saved.id)).toEqual(saved);
  await expect.poll(() => [...setup.storage.values()].flatMap(instances).some((instance) => Object.keys(instance.settings.pineStrategySettings ?? {}).length === 0)).toBe(true);
  await expect.poll(async () => (await redPixels(page)).red).toBeGreaterThan(0);
  let quantResult: any = null;
  if (info.project.name === "desktop") {
    const quantTrigger = page.getByRole("button", { name: "Quant", exact: true });
    if (!await quantTrigger.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
    await quantTrigger.click();
    const quant = page.getByRole("complementary", { name: "Quant assistant", exact: true });
    await expect(quant).toBeVisible();
    await expect(quant.locator('[data-quant-state="provider-loading"]')).toHaveCount(0);
    await quant.getByRole("tab", { name: "Build & backtest", exact: true }).click();
    await quant.getByRole("combobox", { name: "Indicator", exact: true }).selectOption(saved.id);
    await expect(quant.getByRole("heading", { name: "Pine strategy test", exact: true })).toBeVisible();
    const beforeQuant = await responseCount(page);
    await quant.getByRole("button", { name: "Run", exact: true }).click();
    quantResult = await resultFor(page, 3, true, 2000000, 2, beforeQuant);
    const quantLedger = quant.getByRole("region", { name: "Pine strategy results", exact: true });
    await expect(quantLedger).toBeVisible();
    await expect(quantLedger.getByLabel("Test assumptions", { exact: true })).toContainText("3 units");
    await quantLedger.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(folder, "quant-saved-assumptions.png") });
    await quant.getByRole("button", { name: "Close Quant", exact: true }).click();
  }
  const workerName = fs.readdirSync("frontend/dist/assets").find((name) => /^pine-native-worker.*\.js$/.test(name))!;
  const worker = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  expect(setup.workerReceipts.length).toBeGreaterThan(0);
  for (const receipt of setup.workerReceipts) {
    expect(receipt.sha256).toBe(workerSha256);
    expect(receipt.bytes).toBe(worker.length);
  }
  expect(errors).toEqual([]);
  await page.locator(".chart-stage").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(folder, "chart-script-defaults.png") });
  fs.writeFileSync(path.join(folder, "saved-trader-settings.json"), JSON.stringify({ source, settings, original, edited, reloaded, chartEdited, chartReloaded, reset, quantResult, saved, pixels: await redPixels(page), workerName, workerSha256, workerBytes: worker.length, workerReceipts: setup.workerReceipts, operations: [...setup.receipts.values()], errors }, null, 2));
});
