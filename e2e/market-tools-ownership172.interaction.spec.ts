import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { AUTH_SESSION_KEY, betaSessionResponse } from "./support/app";

const baseline = process.env.EDGELAB_MARKET_TOOLS172_BASELINE === "1";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => `${file}:${hash(fs.readFileSync(path.join("frontend/dist", file)))}`).join("\n"));
const hashes = () => Object.fromEntries(["e2e/market-tools-ownership172.config.ts", "e2e/market-tools-ownership172.interaction.spec.ts"].map(file => [file, hash(fs.readFileSync(file))]));
const initialSeal = seal(), initialHashes = hashes(), errors = new WeakMap<Page, string[]>(), fixtures = new WeakMap<Page, Awaited<ReturnType<typeof setup>>>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message));
  await page.addInitScript(() => { if (window !== window.top) return; (window as any).__rejections172 = []; window.addEventListener("unhandledrejection", event => (window as any).__rejections172.push(String(event.reason?.message ?? event.reason))); });
});
test.afterEach(async ({ page }, info) => {
  const fixture = fixtures.get(page); fixture?.release();
  if (!page.isClosed()) await capture(page, info, "terminal", { receipts: fixture?.receipts, rejections: await page.evaluate(() => (window as any).__rejections172 ?? []), body: await page.locator("body").innerText() });
  expect(errors.get(page)).toEqual([]); expect(seal()).toBe(initialSeal); expect(hashes()).toEqual(initialHashes);
});
async function capture(page: Page, info: TestInfo, name: string, evidence: unknown) {
  const folder = path.resolve(".artifacts/market-tools-ownership172", baseline ? "baseline" : "final", info.project.name, info.title.replace(/[^a-z0-9]+/gi, "-")); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify({ scope: "Actual production app and watchlist/Tools controls; only verified authentication, storage and provider HTTP/WebSocket seams. No controller, engine, state or result substitutions.", initialSeal, afterSeal: seal(), initialHashes, afterHashes: hashes(), errors: errors.get(page), evidence }, null, 2));
  await page.screenshot({ path: path.join(folder, `${name}.png`) });
}
async function setup(page: Page, kind: "book" | "delete" | "ack") {
  await liveViewportSetup(page);
  const now = new Date().toISOString(), receipts: any[] = [], gates: Array<() => void> = [];
  let predicate: ((instrument: number, aggregation: number, depth: number) => boolean) | null = null, deleted = false, acknowledged = false, deletes = 0, acks = 0;
  const instrument = (symbol: string, index: number) => ({ id: index + 1, canonical_symbol: symbol, display_name: symbol, asset_class: "crypto", instrument_type: "SPOT", exchange: "BINANCE", currency: "USD", timezone: "UTC", tick_size: ".01", active: true, identifiers: [{ provider: "BINANCE", provider_symbol: symbol }] });
  const rule = { id: 172, instrument_id: 1, name: "Retained rule172", alert_type: "PRICE_CROSSES_ABOVE", condition: { threshold: "67600" }, enabled: true, cooldown_seconds: 60, last_value: null, last_evaluated_at: null, last_triggered_at: null, created_at: now, updated_at: now };
  const event = { id: 173, rule_id: 172, instrument_id: 1, observed_at: now, observed_value: "67601", message: "Attention event172", payload: {}, acknowledged_at: null, created_at: now };
  await page.route(/\/api\/market-data\/(instruments|alerts|alert-events)(?:[/?]|$)/, async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.replace(/^\/api/, "");
    expect(request.headers().authorization).toBe(`Bearer ${betaSessionResponse.token}`);
    if (endpoint === "/market-data/instruments") return route.fulfill({ json: ["BTCUSDT", "ETHUSDT"].map(instrument) });
    const book = endpoint.match(/^\/market-data\/instruments\/(\d+)\/order-book$/);
    if (book) {
      const id = Number(book[1]), aggregation = Number(url.searchParams.get("aggregation_ticks")), depth = Number(url.searchParams.get("depth"));
      const receipt = { endpoint, method: request.method(), instrument: id, aggregation, depth, held: !!predicate?.(id, aggregation, depth), settled: false, canceled: false }; receipts.push(receipt);
      if (receipt.held) await new Promise<void>(resolve => gates.push(resolve));
      const bid = id === 2 ? 3400 : depth === 100 ? 67580 : depth === 50 ? 67560 : aggregation === 5 ? 67550 : aggregation === 2 ? 67522 : 67520;
      try { await route.fulfill({ json: { instrument_id: id, contract_id: null, provider: "BINANCE", sequence: receipts.length, captured_at: now, status: "AVAILABLE", aggregation_tick_size: String(aggregation * .01), message: null,
        levels: [{ side: "ASK", price: String(bid + 1), size: "3", order_count: 4 }, { side: "BID", price: String(bid), size: "2", order_count: 3 }] } }); } catch { receipt.canceled = true; }
      receipt.settled = true; return;
    }
    if (endpoint === "/market-data/alerts") return route.fulfill({ json: deleted || kind === "book" ? [] : [rule] });
    if (endpoint === "/market-data/alert-events") return route.fulfill({ json: acknowledged || kind !== "ack" ? [] : [event] });
    if (endpoint === "/market-data/alerts/172" && request.method() === "DELETE") {
      deletes++; receipts.push({ endpoint, method: request.method(), attempt: deletes, status: deletes === 1 ? 500 : 200 });
      if (deletes === 1) return route.fulfill({ status: 500, json: { detail: "Delete failed172" } });
      deleted = true; return route.fulfill({ json: { ok: true } });
    }
    if (endpoint === "/market-data/alert-events/173/acknowledge" && request.method() === "POST") {
      acks++; receipts.push({ endpoint, method: request.method(), attempt: acks, status: acks === 1 ? 500 : 200 });
      if (acks === 1) return route.fulfill({ status: 500, json: { detail: "Acknowledgement failed172" } });
      acknowledged = true; return route.fulfill({ json: { ...event, acknowledged_at: now } });
    }
    return route.fallback();
  });
  const fixture = { receipts, hold: (next: typeof predicate) => { predicate = next; }, release: () => { predicate = null; gates.splice(0).forEach(resolve => resolve()); } };
  fixtures.set(page, fixture); return fixture;
}
async function panel(page: Page, name: "Order book" | "Alerts") {
  await page.locator('[data-motion="workspace-panel-trigger"]').click();
  const pane = page.getByRole("complementary", { name: "Chart tools", exact: true }); await expect(pane).toBeVisible();
  await pane.getByRole("tab", { name, exact: true }).click(); return pane.getByRole("tabpanel", { name, exact: true });
}
async function choose(page: Page, control: Locator, label: string, option: string) {
  await control.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await control.focus(); await control.press("ArrowDown");
  const menu = page.getByRole("listbox", { name: label, exact: true }); await expect(menu).toBeVisible();
  await menu.getByRole("option", { name: option, exact: true }).click(); await expect(menu).toBeHidden(); await expect(control).toBeFocused();
}
async function releaseSettled(page: Page, fixture: Awaited<ReturnType<typeof setup>>) {
  const held = fixture.receipts.filter(receipt => receipt.held && !receipt.settled); expect(held.length).toBeGreaterThan(0);
  fixture.release(); await expect.poll(() => held.every(receipt => receipt.settled)).toBe(true);
  // A bounded real-clock render observation before the production two-second
  // polling interval can repair a stale overwrite. Never poll away stale values.
  await page.waitForTimeout(200);
}

test("late BTC depth cannot overwrite the watchlist-selected ETH book", async ({ page }, info) => {
  const fixture = await setup(page, "book"); fixture.hold(id => id === 1);
  const order = await panel(page, "Order book"); await expect.poll(() => fixture.receipts.some(receipt => receipt.held)).toBe(true);
  await page.locator("tbody tr").filter({ hasText: "ETHUSDT" }).first().click();
  await expect(page.locator('[data-ui-surface="chart-live"]')).toHaveAttribute("data-active-symbol", "ETHUSDT");
  await expect(order.getByRole("heading", { name: "Order Book · ETHUSDT", exact: true })).toBeVisible(); await expect(order).toContainText("3,401");
  await capture(page, info, "fresh-eth", { receipts: fixture.receipts, book: await order.innerText() });
  await releaseSettled(page, fixture); const text = await order.innerText(); await capture(page, info, "released-btc", { receipts: fixture.receipts, book: text });
  expect(text).toContain("Order Book · ETHUSDT"); expect(text).toContain("3,401"); expect(text).toContain("3,400"); expect(text).not.toContain("67,521");
});

test("new aggregation and depth retain their latest response after older responses arrive", async ({ page }, info) => {
  const fixture = await setup(page, "book"), order = await panel(page, "Order book"); await expect(order).toContainText("67,521");
  const aggregate = order.getByRole("combobox", { name: "Aggregate ticks", exact: true }), depth = order.getByRole("combobox", { name: "Depth", exact: true });
  fixture.hold((id, aggregation, levels) => id === 1 && aggregation === 2 && levels === 20);
  await choose(page, aggregate, "Aggregate ticks", "2 ticks"); await expect.poll(() => fixture.receipts.some(receipt => receipt.held && receipt.aggregation === 2)).toBe(true);
  await choose(page, aggregate, "Aggregate ticks", "5 ticks"); await expect(order).toContainText("67,551");
  await releaseSettled(page, fixture); const aggregationText = await order.innerText(); await capture(page, info, "released-aggregation", { receipts: fixture.receipts, book: aggregationText });
  expect.soft(aggregationText).toContain("67,551"); expect.soft(aggregationText).not.toContain("67,523"); await expect(aggregate).toContainText("5 ticks");
  fixture.hold((id, aggregation, levels) => id === 1 && aggregation === 5 && levels === 50);
  await choose(page, depth, "Depth", "50 levels"); await expect.poll(() => fixture.receipts.some(receipt => receipt.held && receipt.depth === 50)).toBe(true);
  await choose(page, depth, "Depth", "100 levels"); await expect(order).toContainText("67,581");
  await releaseSettled(page, fixture); const depthText = await order.innerText(); await capture(page, info, "released-depth", { receipts: fixture.receipts, book: depthText });
  expect.soft(depthText).toContain("67,581"); expect.soft(depthText).not.toContain("67,561"); await expect(depth).toContainText("100 levels");
});

for (const action of ["delete", "ack"] as const) test(`failed alert ${action} retains its row, reports a recoverable error and allows retry`, async ({ page }, info) => {
  const fixture = await setup(page, action), alerts = await panel(page, "Alerts"), name = action === "delete" ? "Retained rule172" : "Attention event172";
  await expect(alerts.getByText(name, { exact: true })).toBeVisible();
  const perform = async () => {
    if (action === "ack") return alerts.getByRole("button", { name: "Acknowledge", exact: true }).click();
    const confirm = alerts.getByRole("button", { name: "Delete", exact: true });
    if (!await confirm.isVisible()) await alerts.getByRole("button", { name: "Delete Retained rule172", exact: true }).click();
    await confirm.click();
  };
  await perform(); await expect.poll(() => fixture.receipts.some(receipt => receipt.status === 500)).toBe(true); await page.waitForTimeout(200);
  await capture(page, info, "failed-action", { receipts: fixture.receipts, rejections: await page.evaluate(() => (window as any).__rejections172), alerts: await alerts.innerText() });
  await expect(alerts.getByRole("alert")).toContainText(action === "delete" ? "Delete failed172" : "Acknowledgement failed172");
  await expect(alerts.getByText(name, { exact: true })).toBeVisible(); expect(errors.get(page)).toEqual([]); expect(await page.evaluate(() => (window as any).__rejections172)).toEqual([]);
  if (action === "ack") await expect(alerts.getByRole("button", { name: "Acknowledge", exact: true })).toBeEnabled();
  await perform(); await expect(alerts.getByText(name, { exact: true })).toHaveCount(0);
  expect(fixture.receipts.filter(receipt => receipt.attempt)).toEqual([
    { endpoint: action === "delete" ? "/market-data/alerts/172" : "/market-data/alert-events/173/acknowledge", method: action === "delete" ? "DELETE" : "POST", attempt: 1, status: 500 },
    { endpoint: action === "delete" ? "/market-data/alerts/172" : "/market-data/alert-events/173/acknowledge", method: action === "delete" ? "DELETE" : "POST", attempt: 2, status: 200 },
  ]);
  await capture(page, info, "retried", { receipts: fixture.receipts, alerts: await alerts.innerText() });
});

async function notificationApi(page: Page, enabled = false) {
  // Stub only the browser Notification boundary: no OS notifications, and no
  // application delivery logic, permission decision or channels state replaced.
  await page.addInitScript(enabled => {
    if (window !== window.top) return;
    const state = { permission: enabled ? "granted" : "default", requests: 0, notifications: [] as any[], release: null as null | (() => void) };
    class BrowserNotification {
      static get permission() { return state.permission; }
      static requestPermission() { state.requests++; return new Promise<string>(resolve => { state.release = () => { state.permission = "granted"; resolve("granted"); }; }); }
      constructor(title: string, options: any) { state.notifications.push({ title, ...options }); }
      close() {}
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: BrowserNotification });
    (window as any).__notification172 = state;
    localStorage.setItem("edgelab:alert-channels:v1", JSON.stringify({ browser: enabled, sound: false }));
  }, enabled);
}

test("held create preserves a newer edited draft while rendering the submitted rule", async ({ page }, info) => {
  const fixture = await setup(page, "book"), rules: any[] = [], submitted: any[] = [];
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/market-data/alerts", async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${betaSessionResponse.token}`);
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON(); submitted.push(payload); await gate;
      const now = new Date().toISOString(), rule = { id: 174, ...payload, condition: { threshold: payload.threshold }, enabled: true, last_value: null, last_evaluated_at: null, last_triggered_at: null, created_at: now, updated_at: now };
      rules.push(rule); return route.fulfill({ json: rule });
    }
    return route.fulfill({ json: rules });
  });
  try {
    const alerts = await panel(page, "Alerts"), name = alerts.getByLabel("Alert name", { exact: true }), threshold = alerts.getByLabel("Threshold", { exact: true });
    await expect(alerts.getByRole("button", { name: "Create alert", exact: true })).toBeEnabled();
    await name.fill("Submitted rule172"); await threshold.fill("67600"); await alerts.getByRole("button", { name: "Create alert", exact: true }).click();
    await expect.poll(() => submitted.length).toBe(1);
    await name.fill("New draft172"); await threshold.fill("67900"); release();
    await expect(alerts.getByText("Submitted rule172", { exact: true })).toBeVisible();
    await capture(page, info, "create-released", { receipts: fixture.receipts, submitted, draft: { name: await name.inputValue(), threshold: await threshold.inputValue() }, alerts: await alerts.innerText() });
    expect(submitted).toEqual([{ instrument_id: 1, name: "Submitted rule172", alert_type: "PRICE_CROSSES_ABOVE", threshold: 67600, cooldown_seconds: 60 }]);
    await expect(name).toHaveValue("New draft172"); await expect(threshold).toHaveValue("67900"); await expect(alerts.getByRole("button", { name: "Create alert", exact: true })).toBeEnabled();
  } finally { release(); }
});

test("held notification permission preserves a newer Sound toggle", async ({ page }, info) => {
  await notificationApi(page); const fixture = await setup(page, "book"), alerts = await panel(page, "Alerts");
  await alerts.getByRole("button", { name: "Enable browser", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__notification172.requests)).toBe(1);
  await alerts.getByRole("button", { name: "Sound off", exact: true }).click(); await expect(alerts.getByRole("button", { name: "Sound on", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => (window as any).__notification172.release()); await expect(alerts.getByRole("button", { name: "Browser on", exact: true })).toHaveAttribute("aria-pressed", "true");
  await capture(page, info, "permission-released", { receipts: fixture.receipts, channels: await page.evaluate(() => JSON.parse(localStorage.getItem("edgelab:alert-channels:v1")!)), alerts: await alerts.innerText() });
  await expect(alerts.getByRole("button", { name: "Sound on", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("edgelab:alert-channels:v1")!))).toEqual({ browser: true, sound: true });
  expect(await page.evaluate(() => (window as any).__notification172.notifications)).toEqual([]);
});

test("failed first list retries historical events silently then delivers one genuinely fresh event", async ({ page }, info) => {
  await notificationApi(page, true); const fixture = await setup(page, "book"), now = new Date().toISOString();
  const historical = { id: 175, rule_id: 172, instrument_id: 1, observed_at: now, observed_value: "67601", message: "Historical attention172", payload: {}, acknowledged_at: null, created_at: now };
  const fresh = { ...historical, id: 176, message: "Fresh attention172" }; let calls = 0, includeFresh = false;
  await page.route(/\/api\/market-data\/alert-events(?:\?|$)/, async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${betaSessionResponse.token}`); calls++;
    fixture.receipts.push({ endpoint: "/market-data/alert-events", attempt: calls, status: calls === 1 ? 500 : 200, ids: calls === 1 ? [] : includeFresh ? [175, 176] : [175] });
    if (calls === 1) return route.fulfill({ status: 500, json: { detail: "Initial events failed172" } });
    return route.fulfill({ json: includeFresh ? [historical, fresh] : [historical] });
  });
  const alerts = await panel(page, "Alerts"); await expect(alerts.getByRole("alert")).toContainText("Initial events failed172");
  // Production's own ten-second visible-document polling is the retry; do not
  // recreate the panel or invoke application load/delivery methods.
  await expect(alerts.getByText(historical.message, { exact: true })).toBeVisible({ timeout: 25_000 });
  const afterHistorical = await page.evaluate(() => (window as any).__notification172.notifications);
  await capture(page, info, "historical-retry", { receipts: fixture.receipts, notifications: afterHistorical, alerts: await alerts.innerText() }); expect(afterHistorical).toEqual([]);
  includeFresh = true; await expect(alerts.getByText(fresh.message, { exact: true })).toBeVisible({ timeout: 25_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__notification172.notifications)).toEqual([{ title: "EdgeLab alert", body: fresh.message, tag: "edgelab-alert-176" }]);
  await capture(page, info, "fresh-delivery", { receipts: fixture.receipts, notifications: await page.evaluate(() => (window as any).__notification172.notifications), alerts: await alerts.innerText() });
});

test("a queued same-owner identity event reloads the owned book without UI interaction", async ({ page }, info) => {
  const fixture = await setup(page, "book"), order = await panel(page, "Order book"); await expect(order).toContainText("67,521");
  const section = await order.locator('section[aria-labelledby="order-book-panel-title"]').elementHandle();
  let holdOld = true, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/market-data\/instruments(?:[/?]|$)/, async route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    expect(request.headers().authorization).toBe(`Bearer ${betaSessionResponse.token}`);
    if (endpoint === "/market-data/instruments") {
      fixture.receipts.push({ endpoint, kind: "identity-resolution", at: Date.now() }); return route.fallback();
    }
    if (endpoint !== "/market-data/instruments/1/order-book") return route.fallback();
    const held = holdOld, receipt = { endpoint, kind: "identity-depth", held, at: Date.now(), settled: false, canceled: false }; fixture.receipts.push(receipt);
    if (held) await gate;
    const now = new Date().toISOString(), bid = held ? 67520 : 67590;
    try { await route.fulfill({ json: { instrument_id: 1, contract_id: null, provider: "BINANCE", sequence: held ? 1 : 2, captured_at: now, status: "AVAILABLE", aggregation_tick_size: ".01", message: null,
      levels: [{ side: "ASK", price: String(bid + 1), size: "3", order_count: 4 }, { side: "BID", price: String(bid), size: "2", order_count: 3 }] } }); } catch { receipt.canceled = true; }
    receipt.settled = true;
  });
  try {
    await order.getByRole("button", { name: "Refresh order book", exact: true }).click();
    await expect.poll(() => fixture.receipts.some(receipt => receipt.kind === "identity-depth" && receipt.held)).toBe(true);
    const old = fixture.receipts.filter(receipt => receipt.kind === "identity-depth" && receipt.held); holdOld = false;
    const countsBefore = fixture.receipts.length;
    const identity = await page.evaluate(key => {
      const before = localStorage.getItem(key); window.dispatchEvent(new Event("edgelab:auth-session-change"));
      return { before, after: localStorage.getItem(key) };
    }, AUTH_SESSION_KEY);
    await capture(page, info, "queued-identity", { identity, countsBefore, receipts: fixture.receipts });
    expect(identity.before).toBeTruthy(); expect(identity.after).toBe(identity.before);
    // A new normalization request distinguishes a real React owner-generation
    // reload from the existing periodic refresh of its cached instrument.
    await expect.poll(() => fixture.receipts.slice(countsBefore).some(receipt => receipt.kind === "identity-resolution"), { timeout: 750, intervals: [25] }).toBe(true);
    await expect(order).toContainText("67,591");
    expect(await page.evaluate(node => document.querySelector('section[aria-labelledby="order-book-panel-title"]') === node, section)).toBe(true);
    release(); await expect.poll(() => old.every(receipt => receipt.settled)).toBe(true); await page.waitForTimeout(200);
    const text = await order.innerText(); await capture(page, info, "queued-identity-released", { identity, countsBefore, receipts: fixture.receipts, book: text });
    expect(text).toContain("67,591"); expect(text).toContain("67,590"); expect(text).not.toContain("67,521");
  } finally { release(); }
});
