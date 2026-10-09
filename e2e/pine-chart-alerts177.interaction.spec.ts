import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor } from "./pine-layering.product-support";

const name = "Live chart alert177", prefix = "Custom input177";
const source = `//@version=6
indicator("${name}",overlay=true)
prefix=input.string("Default","Prefix")
alert(prefix+":"+str.tostring(close),alert.freq_all)
if close>67535
    alert("${"A long indicator message ".repeat(130)}",alert.freq_all)
plot(close,"Actual price",display=display.none)`;
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort()
  .map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const fixtureSeal = () => Object.fromEntries(["e2e/pine-chart-alerts177.config.ts", "e2e/pine-chart-alerts177.interaction.spec.ts"]
  .map(file => [file, hash(fs.readFileSync(file))]));
async function results(page: Page) {
  return page.evaluate(source => ((window as any).__alerts177 ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    return response?.status === "completed" && response.result?.source === source
      ? [{ sessionId: payload.sessionId, sequence: payload.sequence, alerts: response.result.alertEvents, inputs: response.result.inputs }] : [];
  }), source);
}
async function tools(page: Page) {
  const pane = page.getByRole("complementary", { name: "Chart tools", exact: true });
  if (!await pane.isVisible()) await page.locator('[data-motion="workspace-panel-trigger"]').click();
  await expect(pane).toBeVisible(); await pane.getByRole("tab", { name: "Alerts", exact: true }).click();
  return { pane, alerts: pane.getByRole("tabpanel", { name: "Alerts", exact: true }) };
}

test("real editor and native worker deliver only enabled fresh chart events, respect pause and keep collapsed/mobile toasts bounded", async ({ page }, info) => {
  const initialSeal = seal(), initialFixtureSeal = fixtureSeal(), workers: any[] = [], errors: string[] = [];
  page.on("pageerror", error => {
    if (!error.message.includes("Service worker is disabled because the context is sandboxed")) errors.push(error.message);
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    (window as any).__alerts177 = [];
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__alerts177.push(event.data.payload);
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => {
    const response = await route.fetch(), bytes = await response.body(); workers.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) });
    await route.fulfill({ response, body: bytes });
  });
  await page.route("**/api/market-data/alerts**", route => route.fulfill({ json: [] }));
  await page.route("**/api/market-data/alert-events**", route => route.fulfill({ json: [] }));
  const state = await liveViewportSetup(page), dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByLabel("Prefix", { exact: true })).toBeVisible();
  await dialog.getByLabel("Prefix", { exact: true }).fill(prefix);
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  state.emit(600, 67525, false, 16);
  let { pane, alerts } = await tools(page);
  const enable = () => alerts.getByRole("button", { name: `Enable alerts for ${name}`, exact: true });
  await expect(enable()).toBeEnabled();
  expect((await results(page)).length).toBeGreaterThan(0);
  expect((await results(page)).every(result => !result.alerts)).toBe(true);
  await expect(alerts.getByText("Recent indicator alerts", { exact: true })).toHaveCount(0);
  await enable().click();
  state.emit(600, 67526, false, 17);
  await expect(alerts.locator("ol li")).toHaveCount(1);
  await expect(alerts.locator("ol li").first()).toContainText(`${prefix}:67526`);
  await expect.poll(async () => (await results(page)).some(result => result.alerts?.events.some((event: any) => event.message === `${prefix}:67526`))).toBe(true);
  const toast = page.getByRole("status").filter({ has: page.getByRole("button", { name: "Dismiss indicator alert", exact: true }) });
  await expect(toast).toContainText(`${prefix}:67526`);
  // Hold a provider event until after the actual Pause click; production worker
  // messages and the opaque bridge are never intercepted or replaced.
  const heldProviderEvent = () => state.emit(600, 67527, false, 18);
  await alerts.getByRole("button", { name: `Pause alerts for ${name}`, exact: true }).click();
  const before = (await results(page)).filter(result => result.sessionId).length;
  heldProviderEvent();
  await expect.poll(async () => (await results(page)).filter(result => result.sessionId).length).toBeGreaterThan(before);
  await expect(alerts.locator("ol li")).toHaveCount(1);
  await enable().click();
  await pane.getByRole("button", { name: "Collapse workspace panel", exact: true }).click();
  await page.mouse.move(0, 0); await expect(pane).toBeHidden();
  state.emit(600, 67528, false, 19);
  await expect(toast).toContainText(`${prefix}:67528`);
  state.emit(600, 67536, false, 20);
  await expect(toast).toContainText("A long indicator message");
  const box = await toast.boundingBox(); expect(box).not.toBeNull(); expect(box!.height).toBeLessThan(230);
  expect(box!.width).toBeLessThanOrEqual(info.project.use.viewport!.width - 20);
  const toastBody = toast.locator("p").last();
  expect(await toastBody.evaluate(node => ({ maxHeight: getComputedStyle(node).maxHeight, overflowY: getComputedStyle(node).overflowY })))
    .toEqual({ maxHeight: "128px", overflowY: "auto" });
  const dismiss = toast.getByRole("button", { name: "Dismiss indicator alert", exact: true });
  await expect(dismiss).toBeInViewport();
  const folder = path.resolve(".artifacts/pine-chart-alerts177", info.project.name); fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, "long-alert-collapsed.png") });
  await dismiss.click(); await expect(dismiss).toHaveCount(0);
  await expect.poll(async () => (await results(page)).some(result => result.alerts?.events.length === 2)).toBe(true);
  ({ pane, alerts } = await tools(page));
  await expect(alerts.locator("ol li")).toHaveCount(4);
  await expect(alerts).toContainText("Alerts run while this chart is open.");
  expect(workers.length).toBeGreaterThan(0); expect(errors).toEqual([]); expect(seal()).toBe(initialSeal); expect(fixtureSeal()).toEqual(initialFixtureSeal);
  fs.writeFileSync(path.join(folder, "evidence.json"), JSON.stringify({ workers, sourceSha256: hash(source), distSeal: initialSeal,
    fixtureSeal: initialFixtureSeal, results: await results(page), providerEvents: state.events, viewport: info.project.use.viewport, toast: box, errors }, null, 2));
});
