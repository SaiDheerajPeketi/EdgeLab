import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { editor, checkedRun } from "./pine-layering.product-support";
import { AUTH_SESSION_KEY, FROZEN_TIME } from "./support/app";
import { setupContextProduct, addSource, results, latest, value, hold, heldCount, release, colorCounts, authStorage, contextDiagnostics } from "./pine-context59.support";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, ".artifacts/pine-context59/browser");
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const folder = path.join(artifacts, info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  const filename = info.title.replace(/[^a-zA-Z0-9]+/g, "-");
  fs.writeFileSync(path.join(folder, `${filename}-failure-diagnostics.json`), JSON.stringify(await contextDiagnostics(page), null, 2));
});

const strategyName = "Snapshot owner59";
const strategySource = `//@version=6
strategy("${strategyName}",overlay=true,behind_chart=false)
shift=input.int(10,"Shift",minval=0,maxval=50)
shade=input.color(#ff00ff,"Shade")
plot(close+shift,"Owned price",color=shade,linewidth=4)
plot(barstate.ishistory,"History",display=display.none)
if bar_index%10==8
    strategy.entry("Owned59",strategy.long)
if bar_index%10==9
    strategy.close("Owned59")`;
const indicatorName = "Persistent owner59";
const indicatorSource = `//@version=6
indicator("${indicatorName}",overlay=true,behind_chart=false)
shift=input.int(10,"Shift",minval=0,maxval=50)
var ordinary=0
varip ticks=0
ordinary+=1
ticks+=1
plot(close+shift,"Owned price",color=#ff0000,linewidth=4)
plot(ordinary,"Ordinary",display=display.none)
plot(ticks,"Ticks",display=display.none)
plot(barstate.ishistory,"History",display=display.none)`;
const stage = (page: Page) => page.locator(".chart-stage").first();
const price = (page: Page, name: string) => stage(page).locator(".chart-study-pill").filter({ hasText: `${name} · Owned price` }).locator("strong");

async function positivePrice(page: Page, name: string, expected: number) {
  await expect.poll(async () => Number((await price(page, name).textContent())?.replaceAll(",", ""))).toBe(expected);
}
async function pendingOwnerAbsent(page: Page, name: string, marker = false) {
  await expect(price(page, name)).toHaveCount(0);
  const values = stage(page).locator(".chart-study-pill").filter({ hasText: name }).locator("strong");
  await expect.poll(async () => (await values.allTextContents()).every(text => text === "Error" || text === "—")).toBe(true);
  await expect(stage(page).getByRole("status").filter({ hasText: name })).toHaveCount(0);
  await expect.poll(async () => {
    const pixels = await colorCounts(page);
    return { plot: name === strategyName ? pixels.magenta : pixels.red, marker: marker ? pixels.marker : 0 };
  }).toEqual({ plot: 0, marker: 0 });
}
async function openInputs(page: Page, name: string) {
  const row = page.locator(".native-study-chip").filter({ hasText: name }).first();
  if (!await row.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await row.getByRole("button", { name: `Inputs for ${name}`, exact: true }).click();
  return row;
}
async function closeInputs(page: Page, name: string) {
  await page.getByRole("button", { name: `Close inputs for ${name}`, exact: true }).click();
}
async function chooseSymbol(page: Page, label: string) {
  const row = page.locator("table tbody tr").filter({ hasText: label }).first();
  await expect(row).toBeVisible();
  await row.click();
}
async function chartToolbar(page: Page) {
  const toolbar = page.locator(".chart-studio-toolbar");
  if (!await toolbar.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await expect(toolbar).toBeVisible();
  return toolbar;
}
async function settings(page: Page) {
  const toolbar = await chartToolbar(page);
  await toolbar.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Chart settings", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Scales and lines", exact: true }).click();
  return dialog;
}
async function selectSetting(page: Page, label: string, option: RegExp) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option }).click();
}
async function finish(page: Page, info: TestInfo, setup: Awaited<ReturnType<typeof setupContextProduct>>, name: string, observations: any) {
  await stage(page).scrollIntoViewIfNeeded();
  const folder = path.join(artifacts, info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, `${name}.png`) });
  const workerName = fs.readdirSync(path.join(root, "frontend/dist/assets")).find(name => /^pine-native-worker.*\.js$/.test(name))!;
  const worker = fs.readFileSync(path.join(root, "frontend/dist/assets", workerName));
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  expect(setup.workerReceipts.length).toBeGreaterThan(0);
  expect(setup.workerReceipts.every(receipt => receipt.bytes === worker.length && receipt.sha256 === workerSha256)).toBe(true);
  const trace = await page.evaluate(() => (window as any).__context59.observations);
  await page.goto("/account");
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  expect(setup.errors).toEqual([]);
  fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify({
    observations, events: setup.events, workerName, workerBytes: worker.length, workerSha256,
    workerReceipts: setup.workerReceipts, errors: setup.errors, trace,
    timingScope: "MutationObserver sees committed DOM. The pure chart-runtime-ownership gate proves synchronous matching; this browser does not claim to sample every internal React passive-effect boundary.",
  }, null, 2));
}

test("snapshot inputs source and timeframe discard prior plots notices and strategy markers", async ({ page }, info) => {
  const setup = await setupContextProduct(page);
  const before = await addSource(page, strategySource, true);
  await expect.poll(async () => (await results(page, strategySource)).length).toBeGreaterThan(before);
  const initial = await latest(page, strategySource, result => !result.sessionId && result.audit.bars === 600);
  expect(initial.declaration).toBe("strategy");
  expect(value(initial, "Owned price")).toBe(67569.9);
  await positivePrice(page, strategyName, 67569.9);
  await expect.poll(async () => (await colorCounts(page)).magenta).toBeGreaterThan(0);
  await expect.poll(async () => (await colorCounts(page)).marker).toBeGreaterThan(0);
  const row = await openInputs(page, strategyName);
  await hold(page, strategySource, null, { in_0: 20 });
  await row.getByRole("spinbutton", { name: "Shift", exact: true }).fill("20");
  await expect.poll(() => heldCount(page)).toBeGreaterThan(0);
  await pendingOwnerAbsent(page, strategyName, true);
  await row.getByRole("spinbutton", { name: "Shift", exact: true }).fill("30");
  const fresh = await latest(page, strategySource, result => result.inputs.in_0 === 30);
  expect(value(fresh, "Owned price")).toBe(67589.9);
  await positivePrice(page, strategyName, 67589.9);
  const oldInputRelease = await release(page);
  expect(oldInputRelease.every(item => !item.connected)).toBe(true);
  await positivePrice(page, strategyName, 67589.9);
  await closeInputs(page, strategyName);
  await (await chartToolbar(page)).getByRole("button", { name: "5m", exact: true }).click();
  const fiveMinute = await latest(page, strategySource, result => result.audit.bars === 120);
  expect(value(fiveMinute, "Owned price")).toBe(67589.9);
  await positivePrice(page, strategyName, 67589.9);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  const sourceRow = await openInputs(page, strategyName);
  await hold(page, strategySource, null, { in_0: 40 });
  await sourceRow.getByRole("spinbutton", { name: "Shift", exact: true }).fill("40");
  await expect.poll(() => heldCount(page)).toBeGreaterThan(0);
  await pendingOwnerAbsent(page, strategyName, true);
  await closeInputs(page, strategyName);
  const saved = setup.storage.get("custom-indicator-scripts.v1").find((item: any) => item.source === strategySource);
  const replacementName = "Snapshot replacement59";
  const replacement = strategySource.replace(strategyName, replacementName).replace("plot(close+shift", "plot(close+100").replace("#ff00ff", "#0000ff");
  const dialog = await editor(page);
  await dialog.getByLabel("Script library", { exact: true }).selectOption(saved.id);
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(replacement);
  await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  // Saved library revisions and active chart instances are separate snapshots.
  // Replace the active version through the supported Remove and Add controls.
  await expect(page.locator(".native-study-chip").filter({ hasText: strategyName })).toHaveCount(1);
  await expect(price(page, replacementName)).toHaveCount(0);
  await page.getByRole("button", { name: "Layers", exact: true }).first().click();
  const objectRow = page.locator(".indicator-object-row").filter({ hasText: strategyName }).first();
  await objectRow.getByRole("button", { name: `Settings for ${strategyName}`, exact: true }).click();
  await objectRow.getByRole("button", { name: `Remove ${strategyName}`, exact: true }).click();
  await expect(objectRow).toHaveCount(0);
  await pendingOwnerAbsent(page, strategyName, true);
  await page.getByRole("button", { name: "Collapse chart objects", exact: true }).click();
  const replacementDialog = await editor(page);
  await replacementDialog.getByLabel("Script library", { exact: true }).selectOption(saved.id);
  await expect(replacementDialog.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(replacement);
  await checkedRun(replacementDialog);
  const beforeAdd = (await results(page, replacement)).length;
  await replacementDialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await replacementDialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  await expect.poll(async () => (await results(page, replacement)).length).toBeGreaterThan(beforeAdd);
  const replaced = await latest(page, replacement, result => result.audit.bars === 120);
  expect(value(replaced, "Owned price")).toBe(67659.9);
  await expect(stage(page).locator(".chart-study-pill").filter({ hasText: strategyName })).toHaveCount(0);
  await positivePrice(page, replacementName, 67659.9);
  await expect.poll(async () => (await colorCounts(page)).blue).toBeGreaterThan(0);
  const oldSourceRelease = await release(page);
  expect(oldSourceRelease.length).toBeGreaterThan(0);
  expect(oldSourceRelease.every(item => !item.connected)).toBe(true);
  await positivePrice(page, replacementName, 67659.9);
  await expect(stage(page).getByRole("status").filter({ hasText: strategyName })).toHaveCount(0);
  await expect.poll(async () => (await colorCounts(page)).magenta).toBe(0);
  expect(setup.storage.get("custom-indicator-scripts.v1").find((item: any) => item.id === saved.id).source).toBe(replacement);
  await finish(page, info, setup, "snapshot-transitions", {
    initial, fresh, oldInputRelease, fiveMinute, replaced, oldSourceRelease,
    source: strategySource, replacement,
    sourceWorkflow: "Save a library revision, remove the old chart snapshot, then Check/Run/Add the saved replacement; Save alone does not update active instances.",
  });
});

test("persistent symbol source failure timeframe and session filtering preserve exact producing context", async ({ page }, info) => {
  const setup = await setupContextProduct(page);
  await addSource(page, indicatorSource);
  setup.emit("BTCUSDT");
  const initial = await latest(page, indicatorSource, result => result.sequence === 1);
  expect(value(initial, "Owned price")).toBe(67571);
  await positivePrice(page, indicatorName, 67571);
  await hold(page, indicatorSource, 2);
  setup.emit("BTCUSDT", 600, 2);
  await expect.poll(() => heldCount(page)).toBe(1);
  setup.failSource("ETHUSDT");
  await chooseSymbol(page, "ETHUSDT");
  await expect(stage(page).getByText("ETHUSDT", { exact: true })).toBeVisible();
  await pendingOwnerAbsent(page, indicatorName);
  const failedSymbolRelease = await release(page);
  expect(failedSymbolRelease.every(item => !item.connected)).toBe(true);
  await pendingOwnerAbsent(page, indicatorName);
  setup.failSource(null);
  await chooseSymbol(page, "BTCUSDT");
  await chooseSymbol(page, "ETHUSDT");
  await expect.poll(() => setup.sockets.some(socket => socket.url().includes("ethusdt@kline_1m"))).toBe(true);
  setup.emit("ETHUSDT", 600, 3);
  const recovered = await latest(page, indicatorSource, result => result.sessionId !== initial.sessionId && result.sequence === 1 && value(result, "Owned price") === 748);
  expect(value(recovered, "Ticks")).toBe(601);
  await positivePrice(page, indicatorName, 748);
  await (await chartToolbar(page)).getByRole("button", { name: "5m", exact: true }).click();
  const fiveMinute = await latest(page, indicatorSource, result => result.sessionId !== recovered.sessionId && result.sequence === 1 && result.audit.bars === 121);
  expect(value(fiveMinute, "Owned price")).toBe(748);
  expect(value(fiveMinute, "Ticks")).toBe(121);
  const settingsDialog = await settings(page);
  await selectSetting(page, "Session template", /^India equities/);
  await selectSetting(page, "Trading hours", /^RTH.*Regular only/);
  await settingsDialog.getByRole("button", { name: "Close chart settings", exact: true }).click();
  const filtered = await latest(page, indicatorSource, result => !result.sessionId && result.audit.bars === 75);
  expect(value(filtered, "Owned price")).toBe(741.9);
  expect(filtered.plots.find((plot: any) => plot.name === "History").values.every((item: any) => item === true)).toBe(true);
  await positivePrice(page, indicatorName, 741.9);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  await settings(page);
  await selectSetting(page, "Session template", /^Crypto 24/);
  await selectSetting(page, "Trading hours", /^ETH.*All source bars/);
  await page.getByRole("dialog", { name: "Chart settings", exact: true }).getByRole("button", { name: "Close chart settings", exact: true }).click();
  const resumed = await latest(page, indicatorSource, result => result.sessionId && result.sessionId !== fiveMinute.sessionId && result.sequence === 1 && value(result, "Owned price") === 748);
  await positivePrice(page, indicatorName, 748);
  await finish(page, info, setup, "feed-context-transitions", { initial, failedSymbolRelease, recovered, fiveMinute, filtered, resumed, failure: "Controlled ETH REST503 boundary", source: indicatorSource });
});

async function installAuthBoundary(page: Page, setup: Awaited<ReturnType<typeof setupContextProduct>>) {
  let current = await authStorage(page);
  const tokenOwners = new Map<string, number>([[current.token, current.user.id]]);
  const ownerStorage = new Map<number, Map<string, any>>([[current.user.id, setup.storage]]);
  const operations = setup.receipts;
  await page.route("**/api/auth/session", route => route.fulfill({ json: {
    token: current.token, created_at: current.createdAt, expires_at: current.expiresAt,
    user: { id: current.user.id, email: current.user.email, name: current.user.name, provider: "google", approved: current.user.approved,
      beta_position: current.user.betaPosition, deployment_mode: "production", workspace_access: true, access_expires_at: current.user.accessExpiresAt, is_beta_user: false, plan: "pro" },
  } }));
  await page.route("**/api/app-data/operations/**", route => {
    const request = route.request();
    expect(tokenOwners.has(request.headers().authorization?.replace(/^Bearer /, ""))).toBe(true);
    const id = new URL(request.url()).pathname.split("/").at(-2)!;
    if (request.url().endsWith("/reserve")) operations.set(id, { operation_id: id, ...request.postDataJSON(), status: "reserved", http_status: null, result: null, created_at: FROZEN_TIME, completed_at: null });
    expect(operations.has(id)).toBe(true);
    return route.fulfill({ json: operations.get(id) });
  });
  await page.route("**/api/app-storage/edgelab/**", route => {
    const request = route.request();
    expect(tokenOwners.has(request.headers().authorization?.replace(/^Bearer /, ""))).toBe(true);
    const token = request.headers().authorization?.replace(/^Bearer /, "");
    const storage = ownerStorage.get(tokenOwners.get(token!)!)!;
    const key = decodeURIComponent(new URL(request.url()).pathname.split("/").at(-1)!);
    if (request.method() === "PUT") storage.set(key, structuredClone(request.postDataJSON().value));
    const bound = request.headers()["x-edgelab-operation-id"];
    if (bound) {
      const operation = operations.get(bound);
      expect(operation).toMatchObject({
        method: request.method(),
        path: new URL(request.url()).pathname.replace(/^\/api/, ""),
        status: "reserved",
      });
      Object.assign(operation, { status: "completed", http_status: 200, completed_at: FROZEN_TIME });
    }
    return route.fulfill({ json: { namespace: "edgelab", key, value: storage.get(key) ?? null, updated_at: FROZEN_TIME } });
  });
  return async (newUser = false) => {
    current = { ...current, token: `${current.token}-rotated59`, user: { ...current.user, ...(newUser ? { id: current.user.id + 1, email: "owner59@example.test", name: "Second owner59" } : {}) } };
    tokenOwners.set(current.token, current.user.id);
    if (!ownerStorage.has(current.user.id)) ownerStorage.set(current.user.id, new Map());
    await page.evaluate(({ current, key }) => {
      const oldValue = localStorage.getItem(key);
      const newValue = JSON.stringify(current);
      localStorage.setItem(key, newValue);
      dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage }));
    }, { current, key: AUTH_SESSION_KEY });
    return { userId: current.user.id, boundary: "Simulated authenticated cross-tab storage notification; no account-switch UI is asserted." };
  };
}

test("authenticated token and account transitions reject authentic old live publications", async ({ page }, info) => {
  const setup = await setupContextProduct(page);
  const changeAuth = await installAuthBoundary(page, setup);
  await addSource(page, indicatorSource);
  setup.emit("BTCUSDT");
  const initial = await latest(page, indicatorSource, result => result.sequence === 1);
  await positivePrice(page, indicatorName, 67571);
  await hold(page, indicatorSource, 2);
  setup.emit("BTCUSDT", 600, 2);
  await expect.poll(() => heldCount(page)).toBe(1);
  const rotatedIdentity = await changeAuth();
  await pendingOwnerAbsent(page, indicatorName);
  const oldTokenRelease = await release(page);
  expect(oldTokenRelease.every(item => !item.connected)).toBe(true);
  await pendingOwnerAbsent(page, indicatorName);
  await expect.poll(() => setup.sockets.length).toBeGreaterThan(0);
  setup.emit("BTCUSDT", 600, 4);
  const rotated = await latest(page, indicatorSource, result => result.sessionId !== initial.sessionId && result.sequence === 1 && value(result, "Owned price") === 67574);
  await positivePrice(page, indicatorName, 67574);
  await hold(page, indicatorSource, 2);
  setup.emit("BTCUSDT", 600, 5);
  await expect.poll(() => heldCount(page)).toBe(1);
  const secondIdentity = await changeAuth(true);
  await pendingOwnerAbsent(page, indicatorName);
  const oldAccountRelease = await release(page);
  expect(oldAccountRelease.every(item => !item.connected)).toBe(true);
  await pendingOwnerAbsent(page, indicatorName);
  // The second account has an empty owner-scoped saved workspace. Prepare and
  // save its own genuine study rather than returning the first account's data.
  await addSource(page, indicatorSource);
  await expect.poll(() => setup.sockets.length).toBeGreaterThan(0);
  setup.emit("BTCUSDT", 600, 6);
  const secondOwner = await latest(page, indicatorSource, result => result.sessionId !== rotated.sessionId && result.sequence === 1 && value(result, "Owned price") === 67576);
  await positivePrice(page, indicatorName, 67576);
  await finish(page, info, setup, "auth-context-transitions", { initial, rotatedIdentity, oldTokenRelease, rotated, secondIdentity, oldAccountRelease, secondOwner, source: indicatorSource });
});
