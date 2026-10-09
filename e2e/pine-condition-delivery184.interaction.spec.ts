import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor } from "./pine-layering.product-support";

const name = "Named conditions184";
const source = `//@version=6
indicator("${name}",overlay=true)
threshold=input.float(67525,"Threshold")
alertcondition(close>threshold,"Above custom threshold","{{ticker}} {{interval}} close={{close}} raw={{plot_0}}")
alertcondition(barstate.isconfirmed,"Candle confirmed","Closed {{close}}")
plot(close+1,"After condition",offset=2,display=display.none)`;
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String)
  .filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort()
  .map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const files = () => Object.fromEntries(["e2e/pine-condition-delivery184.config.ts", "e2e/pine-condition-delivery184.interaction.spec.ts"]
  .map(file => [file, hash(fs.readFileSync(file))]));
async function choose(page: Page, label: string, option: string) {
  const field = page.getByRole("combobox", { name: label, exact: true });
  if (await field.evaluate(node => node.tagName === "SELECT")) await field.selectOption({ label: option });
  else { await field.click(); await page.getByRole("option", { name: option, exact: true }).click(); }
}
async function responses(page: Page) {
  return page.evaluate(source => ((window as any).__conditions184 ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    return response?.status === "completed" && response.result?.source === source
      ? [{ sessionId: payload.sessionId, sequence: payload.sequence, samples: response.result.conditionSamples,
        definitions: response.result.alertConditions, inputs: response.result.inputs }] : [];
  }), source);
}

test("actual editor conditions and frequency control fresh named notifications from genuine primary executions", async ({ page }, info) => {
  const before = seal(), fixture = files(), errors: string[] = [], knownSandboxErrors: string[] = [], workers: any[] = [];
  page.on("pageerror", error => {
    if (error.message.includes("Service worker is disabled because the context is sandboxed")) knownSandboxErrors.push(error.message);
    else errors.push(error.message);
  });
  await page.addInitScript(() => {
    if (window !== window.top) return; (window as any).__conditions184 = [];
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')]
        .find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__conditions184.push(event.data.payload);
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => {
    const response = await route.fetch(), bytes = await response.body(); workers.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) });
    await route.fulfill({ response, body: bytes });
  });
  await page.route("**/api/market-data/alerts**", route => route.fulfill({ json: [] }));
  await page.route("**/api/market-data/alert-events**", route => route.fulfill({ json: [] }));
  const feed = await liveViewportSetup(page), dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByLabel("Threshold", { exact: true })).toBeVisible();
  await dialog.getByLabel("Threshold", { exact: true }).fill("67530");
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  feed.emit(600, 67529, false, 16);
  const pane = page.getByRole("complementary", { name: "Chart tools", exact: true });
  if (!await pane.isVisible()) await page.locator('[data-motion="workspace-panel-trigger"]').click();
  await pane.getByRole("tab", { name: "Alerts", exact: true }).click();
  const alerts = pane.getByRole("tabpanel", { name: "Alerts", exact: true });
  const enable = () => alerts.getByRole("button", { name: `Enable alerts for ${name}`, exact: true });
  await expect(enable()).toBeEnabled();
  await choose(page, `Condition for ${name}`, "Above custom threshold");
  await choose(page, `Frequency for ${name}`, "Once per candle");
  await enable().click();
  feed.emit(600, 67529, false, 17);
  await expect.poll(async () => (await responses(page)).some(result => result.samples?.samples.some((sample: any) => sample.conditions[0] === false))).toBe(true);
  await expect(alerts.locator("ol li")).toHaveCount(0);
  feed.emit(600, 67531, false, 18);
  await expect(alerts.locator("ol li")).toHaveCount(1);
  await expect(alerts.locator("ol li").first()).toContainText("BTCUSDT 1 close=67531 raw=67532");
  feed.emit(600, 67532, false, 19);
  await expect.poll(async () => (await responses(page)).some(result => result.samples?.samples.some((sample: any) => sample.bar.close === 67532))).toBe(true);
  await expect(alerts.locator("ol li")).toHaveCount(1);
  // Selecting another condition pauses and changes only future eligibility.
  await choose(page, `Condition for ${name}`, "Candle confirmed");
  await choose(page, `Frequency for ${name}`, "At candle close");
  await expect(enable()).toBeEnabled(); await enable().click();
  feed.emit(600, 67533, false, 20);
  await expect.poll(async () => (await responses(page)).some(result => result.samples?.samples.some((sample: any) => sample.bar.close === 67533))).toBe(true);
  await expect(alerts.locator("ol li")).toHaveCount(1);
  feed.emit(600, 67534, true, 21);
  await expect(alerts.locator("ol li")).toHaveCount(2);
  await expect(alerts.locator("ol li").first()).toContainText("Closed 67534");
  await alerts.getByRole("button", { name: `Pause alerts for ${name}`, exact: true }).click();
  const beforePausedTick = (await responses(page)).length;
  feed.emit(601, 67535, false, 22);
  await expect.poll(async () => (await responses(page)).length).toBeGreaterThan(beforePausedTick);
  expect((await responses(page)).at(-1)?.samples).toBeUndefined();
  await expect(alerts.locator("ol li")).toHaveCount(2);
  const folder = path.resolve(".artifacts/pine-condition-delivery184", info.project.name); fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, "named-conditions.png") });
  expect(errors).toEqual([]); expect(workers.length).toBeGreaterThan(0); expect(seal()).toBe(before); expect(files()).toEqual(fixture);
  fs.writeFileSync(path.join(folder, "evidence.json"), JSON.stringify({ distSeal: before, fixture, workers, sourceSha256: hash(source),
    responses: await responses(page), providerEvents: feed.events, errors, knownSandboxErrors }, null, 2));
});
