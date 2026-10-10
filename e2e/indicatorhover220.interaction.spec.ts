import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { liveViewportSetup } from "./chart-viewport151.support";

type Bar = { time: number; close: number; high: number; low: number };
// Independent numeric oracle: no production indicator functions or rendered values are inputs.
function oracle(bars: Bar[]) {
  function ema(values: number[], length: number) {
    const alpha = 2 / (length + 1), output = [values[0]];
    for (let index = 1; index < values.length; index++) output.push(alpha * values[index] + (1 - alpha) * output[index - 1]);
    return output;
  }
  const closes = bars.map(bar => bar.close), fast = ema(closes, 12), slow = ema(closes, 26);
  const macd = fast.map((value, index) => value - slow[index]), signal = ema(macd, 9);
  const rsi = Array<number>(bars.length).fill(Number.NaN);
  const atr = Array<number>(bars.length).fill(Number.NaN);
  const ranges = bars.map((bar, index) => index ? Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index - 1].close), Math.abs(bar.low - bars[index - 1].close)) : bar.high - bar.low);
  let gain = 0, loss = 0;
  for (let index = 1; index <= 14; index++) {
    const delta = closes[index] - closes[index - 1]; gain += Math.max(0, delta) / 14; loss += Math.max(0, -delta) / 14;
  }
  for (let index = 14; index < bars.length; index++) {
    if (index > 14) { const delta = closes[index] - closes[index - 1]; gain += (Math.max(0, delta) - gain) / 14; loss += (Math.max(0, -delta) - loss) / 14; }
    rsi[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  atr[13] = ranges.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14;
  for (let index = 14; index < bars.length; index++) atr[index] = atr[index - 1] + (ranges[index] - atr[index - 1]) / 14;
  return { rsi, atr, macd, signal, histogram: macd.map((value, index) => value - signal[index]) };
}
async function addIndicators(page: Page) {
  const toolbar = page.locator(".chart-studio-toolbar");
  await toolbar.getByRole("button", { name: "Indicators", exact: true }).click();
  const catalog = page.getByRole("dialog", { name: /Indicator/ }).first();
  for (const [query, name] of [["Relative Strength Index", "RSI"], ["MACD", "MACD"], ["Average True Range", "ATR"]]) {
    await catalog.getByLabel("Search indicators by name, description, category, or synonym", { exact: true }).fill(query);
    await catalog.getByRole("button", { name: `Add ${name} indicator`, exact: true }).click();
  }
  await page.keyboard.press("Escape"); await expect(catalog).toBeHidden();
}
async function bounds(tooltip: Locator, page: Page) {
  const box = (await tooltip.boundingBox())!, viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test("real RSI MACD ATR values follow pointer keyboard and touch with bounded readouts", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const state = await liveViewportSetup(page, false, "/app/live", true);
  const theme = info.project.name.endsWith("light") ? "light" : "dark";
  await page.evaluate(async appTheme => {
    const modulePath = "/src/lib/settingsPreferences.ts";
    const { saveSettingsPreferences } = await import(modulePath);
    await saveSettingsPreferences({ appTheme, density: "comfortable", includeDiagnosticsByDefault: true });
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-app-theme", theme);
  await addIndicators(page);
  const expected = oracle(state.history);
  const definitions = [
    { label: "RSI 14", rows: ["RSI"], values: (index: number) => [expected.rsi[index].toFixed(1)] },
    { label: "MACD 12 26 9", rows: ["MACD", "Signal", "Histogram"], values: (index: number) => [expected.macd[index], expected.signal[index], expected.histogram[index]].map(value => value.toFixed(5)) },
    { label: "ATR 14", rows: ["ATR 14"], values: (index: number) => [expected.atr[index].toFixed(5)] },
  ];
  const mobile = info.project.name.startsWith("mobile");
  const receipts: unknown[] = [];
  const directory = path.resolve(".artifacts/indicatorhover220", info.project.name); fs.mkdirSync(directory, { recursive: true });
  for (const definition of definitions) {
    const plot = page.getByRole("group", { name: `${definition.label} indicator values`, exact: true });
    await expect(plot).toBeVisible(); await plot.evaluate(element => element.scrollIntoView({ block: "center" }));
    const readout = page.locator("[data-indicator-tooltip]");
    async function check(index: number, interaction: string) {
      await expect(readout).toBeVisible();
      for (const [row, value] of definition.values(index).entries()) await expect(readout.locator(`[data-indicator-value="${definition.rows[row]}"]`)).toHaveText(value);
      const time = readout.locator("time");
      await expect(time).toHaveAttribute("datetime", new Date(state.history[index].time * 1000).toISOString());
      const tooltip = page.getByRole("tooltip").filter({ has: readout });
      await bounds(tooltip, page);
      const tooltipWidth = (await tooltip.boundingBox())!.width;
      if (!mobile) expect(tooltipWidth).toBeLessThanOrEqual(221);
      receipts.push({ indicator: definition.label, interaction, index, time: state.history[index].time, expected: definition.values(index), tooltipWidth, text: await readout.innerText() });
    }
    if (!mobile) {
      await plot.focus(); await page.keyboard.press("Home"); await check(440, "Home");
      await page.keyboard.press("ArrowRight"); await check(441, "ArrowRight");
      await page.keyboard.press("End"); await check(599, "End");
      await page.keyboard.press("Escape"); await expect(readout).toHaveCount(0);
    }
    const box = (await plot.boundingBox())!;
    const point = { x: box.x + box.width * 80 / 159, y: box.y + box.height / 2 };
    expect(await plot.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), point)).toBe(true);
    if (mobile) await page.touchscreen.tap(point.x, point.y); else await page.mouse.move(point.x, point.y);
    await check(520, mobile ? "tap" : "pointer");
    await expect(page.getByRole("group", { name: "Indicator settings", exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(directory, definition.label.replaceAll(" ", "-") + ".png"), animations: "disabled" });
    if (mobile) { await plot.focus(); await page.keyboard.press("Escape"); } else await page.mouse.move(page.viewportSize()!.width - 1, 1);
    await expect(readout).toHaveCount(0);
  }
  await page.locator(".indicator-pane-title").filter({ hasText: /^RSI 14$/ }).click();
  await expect(page.getByRole("group", { name: "Indicator settings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close indicator settings", exact: true }).click();
  expect(errors).toEqual([]);
  fs.writeFileSync(path.join(directory, "values.json"), JSON.stringify({ theme, mobile, errors, receipts,
    qualification: "Actual Live chart and built-in indicator calculations on 600 deterministic provider candles. Independent test-only Wilder RSI/ATR and EMA MACD oracle. Only auth/storage/provider transport fixtures and production theme preference API are controlled." }, null, 2));
});
