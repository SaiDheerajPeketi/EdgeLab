import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { editor, checkedRun } from "./pine-layering.product-support";
import { AUTH_SESSION_KEY, betaSessionResponse, gotoStable, installDeterminism, seedChartLayout } from "./support/app";
import { fulfillReplayContext } from "./support/replay-context";
import { formatChartTimeframeLabel } from "../frontend/src/lib/charting";

const artifacts = path.resolve(".artifacts/pine-live-strategy147");
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function seal() {
  const files = fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile());
  return { files: files.length, sha256: hash(files.sort().map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n")) };
}
const beforeSeal = seal();
const testHashes = () => Object.fromEntries(["e2e/pine-live-strategy147.config.ts", "e2e/pine-live-strategy147.spec.ts"].map(file => [file, hash(fs.readFileSync(file))]));
const beforeTestHashes = testHashes();
const errors = new WeakMap<Page, string[]>(), harnessErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  errors.set(page, []); harnessErrors.set(page, []);
  page.on("pageerror", error => {
    if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") harnessErrors.get(page)!.push(error.message);
    else errors.get(page)!.push(error.message);
  });
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); expect(seal()).toEqual(beforeSeal); expect(testHashes()).toEqual(beforeTestHashes); });
function source(title: string, everyTick: boolean) {
  return `//@version=6
strategy("${title}",overlay=true,calc_on_every_tick=${everyTick},initial_capital=1000000)
units=input.int(1,"Units",minval=1,maxval=3)
varip int calculations=0
calculations+=units
plot(calculations,"Calculations",display=display.none)
plot(close,"Price",color=#ff00ff,linewidth=3)
plot(strategy.position_size,"Position",display=display.none)
${Array.from({ length: 5 }, (_, i) => `plot(close+${i},"Packing channel ${i}",display=display.none)`).join("\n")}
if barstate.isrealtime and close<67525 and strategy.position_size==0
    strategy.entry("Long147",strategy.long,qty=units)
if barstate.isrealtime and close>67525 and strategy.position_size>0
    strategy.close("Long147")`;
}
const ordinarySource = '//@version=6\nindicator("Ordinary147",overlay=true)\nvarip int ticks=0\nticks+=1\nplot(ticks,"Ticks",display=display.none)\nplot(close,"Price",color=#ffffff)';
async function setup(page: Page, timeframe = "1m") {
  const now = Date.now(), currentMinute = Math.floor(now / 60_000) * 60, origin = currentMinute - 600 * 60;
  const history = Array.from({ length: 600 }, (_, i) => ({ time: origin + i * 60, open: 67500 + i / 100 - 1,
    high: 67500 + i / 100 + 2, low: 67500 + i / 100 - 2, close: 67500 + i / 100, volume: 10 }));
  const sockets: any[] = [], providerEvents: any[] = [], workerReceipts: any[] = [], storage = new Map<string, any>(), operations = new Map<string, any>();
  await page.routeWebSocket(/data-stream\.binance\.vision/, socket => { sockets.push(socket); socket.onClose(() => { const index = sockets.indexOf(socket); if (index >= 0) sockets.splice(index, 1); }); });
  // Same API/provider seams as productSetup, with actual current Date and lease.
  // The application, chart, runtime controller, opaque bridge and worker stay real.
  await installDeterminism(page, { freezeTime: false, keepBinanceWebSocket: true });
  await seedChartLayout(page, "single"); await fulfillReplayContext(page);
  const session = { ...betaSessionResponse, created_at: new Date(now).toISOString(), expires_at: new Date(now + 86_400_000).toISOString(),
    user: { ...betaSessionResponse.user, provider: "google", deployment_mode: "production", workspace_access: true,
      access_expires_at: new Date(now + 300_000).toISOString(), is_beta_user: false, plan: "pro" } };
  await page.addInitScript(({ session, key }) => {
    if (window !== window.top) return;
    const user = session.user;
    localStorage.setItem(key, JSON.stringify({ createdAt: session.created_at, expiresAt: session.expires_at, token: session.token, user: {
      id: user.id, email: user.email, name: user.name, provider: user.provider, approved: user.approved, betaPosition: user.beta_position,
      deploymentMode: user.deployment_mode, workspaceAccess: user.workspace_access, accessExpiresAt: user.access_expires_at, isBetaUser: user.is_beta_user, plan: user.plan } }));
    const state: any = { results: [], latestLive: {}, hold: null, held: null }; (window as any).__strategy147 = state;
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (!frame || event.origin !== "null" || event.data?.type !== "result") return;
      state.results.push(event.data.payload);
      const payload = event.data.payload;
      if (payload?.protocol === "pine-live-v1" && payload.response?.status === "completed" && payload.response.result?.kind === "run") {
        state.latestLive[payload.response.result.source] = payload;
      }
      if (state.hold && event.data.payload?.sessionId === state.hold.sessionId && event.data.payload?.sequence === state.hold.sequence) {
        state.held = event; event.stopImmediatePropagation();
      }
    }, true);
  }, { session, key: AUTH_SESSION_KEY });
  await page.route("**/assets/pine-native-worker*.js", async route => { const response = await route.fetch(), bytes = await response.body();
    workerReceipts.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) }); await route.fulfill({ response, body: bytes }); });
  await page.route("**/api/**", async route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/session") return route.fulfill({ json: session });
    if (endpoint === "/auth/config") return route.fulfill({ json: { deployment_mode: "production", google_enabled: true, manual_access_enabled: false, dev_auth_bypass_enabled: false } });
    if (endpoint === "/billing/status") return route.fulfill({ json: { provider: "stripe", mode: "live", configured: true, workspace_access: true, subscription_access: true,
      plan: "pro", status: "active", cadence: "monthly", current_period_end: session.expires_at, verified_at: session.created_at, refresh_required: false, cancel_at_period_end: false } });
    const operation = endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (operation) { const [, id, action] = operation;
      if (action === "reserve") operations.set(id, { operation_id: id, ...request.postDataJSON(), status: "reserved", http_status: null, result: null, created_at: session.created_at, completed_at: null });
      expect(operations.has(id)).toBe(true); return route.fulfill({ json: operations.get(id) }); }
    const bound = request.headers()["x-edgelab-operation-id"];
    if (bound) { expect(operations.get(bound)).toMatchObject({ method: request.method(), path: endpoint, status: "reserved" }); Object.assign(operations.get(bound), { status: "completed", http_status: 200, completed_at: new Date().toISOString() }); }
    const encoded = endpoint.match(/^\/app-storage\/edgelab\/(.+)$/)?.[1];
    if (encoded) { const key = decodeURIComponent(encoded); if (request.method() === "PUT") storage.set(key, structuredClone(request.postDataJSON().value));
      return route.fulfill({ json: { namespace: "edgelab", key, value: storage.get(key) ?? null, updated_at: new Date().toISOString() } }); }
    if (endpoint === "/live/binance/instruments") return route.fulfill({ json: { provider: "binance", instruments: [{ symbol: "BTCUSDT", name: "BTCUSDT", status: "TRADING", asset_class: "crypto", base_asset: "BTC", quote_asset: "USDT", tick_size: .01, min_quantity: .00001, quantity_step: .00001 }], total: 1 } });
    return route.fallback();
  });
  await page.route("https://data-api.binance.vision/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/klines")) return route.fulfill({ json: url.searchParams.has("endTime") ? [] : history.map(bar => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), bar.time * 1000 + 59999]) });
    if (url.pathname.endsWith("/ticker/24hr")) return route.fulfill({ json: [{ symbol: "BTCUSDT", lastPrice: "67505.99", priceChange: "1", priceChangePercent: ".1", highPrice: "67600", lowPrice: "67400", volume: "1000", quoteVolume: "67500000", openPrice: "67500", closeTime: now }] });
    return route.fulfill({ json: { symbols: [{ symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" }] } });
  });
  await gotoStable(page, "/app/live", { waitForNetworkIdle: false }); await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  const timeframeLabel = formatChartTimeframeLabel(timeframe);
  if (!await page.getByRole("button", { name: timeframeLabel, exact: true }).first().isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: timeframeLabel, exact: true }).first().click();
  await expect.poll(() => sockets.some(socket => socket.url().includes("btcusdt@kline_1m"))).toBe(true);
  let eventTime = now;
  const emit = (index: number, close: number, confirmed = false) => {
    const bar = { time: origin + index * 60, open: 67520, high: Math.max(67540, close), low: 67500, close, volume: 15 };
    const event = { stream: "btcusdt@kline_1m", data: { e: "kline", E: ++eventTime, s: "BTCUSDT", k: { t: bar.time * 1000, T: bar.time * 1000 + 59999,
      i: "1m", s: "BTCUSDT", o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(close), v: String(bar.volume), x: confirmed } } };
    providerEvents.push(event); for (const socket of sockets) if (socket.url().includes("btcusdt@kline_1m")) socket.send(JSON.stringify(event)); return bar;
  };
  return { storage, workerReceipts, providerEvents, history, emit, now };
}
async function add(page: Page, text: string, state: Awaited<ReturnType<typeof setup>>, strategy = true) {
  const dialog = await editor(page); await dialog.getByLabel("New script template", { exact: true }).selectOption(strategy ? "pine-strategy" : "pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(text); await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((item: any) => item.source === text)).toBe(true);
  const saved = structuredClone(state.storage.get("custom-indicator-scripts.v1").find((item: any) => item.source === text));
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click(); await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click(); return saved;
}
async function results(page: Page, source: string) {
  return page.evaluate(text => {
    const payloads = (window as any).__strategy147.results;
    return payloads.flatMap((payload: any) => {
      const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
      if (response?.status !== "completed" || result?.kind !== "run" || result.source !== text) return [];
      const previous = payloads.find((item: any) => item.sessionId === payload.sessionId && item.sequence === payload.sequence - 1)?.response;
      const packed = response.encoding === "pine-packed-v1", previousPacked = previous?.encoding === "pine-packed-v1";
      return [{ ...result, sessionId: payload.sessionId, sequence: payload.sequence, encoding: response.encoding ?? "json",
        freshBuffers: packed ? !previousPacked || response.buffers.every((buffer: ArrayBuffer) => !previous.buffers.includes(buffer)) : null,
        bufferBytes: packed ? response.buffers.map((buffer: ArrayBuffer) => buffer.byteLength) : [],
        retainedPreviousBufferBytes: previousPacked ? previous.buffers.map((buffer: ArrayBuffer) => buffer.byteLength) : [],
        plotTransport: result.plots.map((plot: any) => { if (!plot.packed) return { name: plot.name, count: plot.points.length, slots: null, missing: [] };
          const kinds = new Uint8Array(response.buffers[plot.packed.kinds]); return { name: plot.name, count: plot.packed.count, slots: plot.packed.slots,
            missing: Array.from({ length: plot.packed.slots }, (_, i) => i).filter(i => kinds[i] === 0) }; }),
        plots: result.plots.map((plot: any) => { if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
          const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
          // Empty transport slots are absent samples. Kind1 remains genuine NA.
          return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? values[i] : kinds[i] === 3 ? true : kinds[i] === 2 ? false : null).filter((_, i) => kinds[i] !== 0) }; }) }];
    });
  }, source);
}
const tail = (result: any, name: string) => result.plots.find((plot: any) => plot.name === name).values.at(-1);
async function observed(page: Page, text: string, predicate: (result: any) => boolean) {
  try { await expect.poll(async () => (await results(page, text)).some(predicate)).toBe(true); }
  catch (error) {
    const directory = path.join(artifacts, test.info().project.name); fs.mkdirSync(directory, { recursive: true });
    const lifecycle = await page.evaluate(() => ({ frames: [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].map(frame => ({ connected: frame.isConnected, nonce: frame.srcdoc.match(/data-job="([a-f0-9]+)"/)?.[1] })),
      responses: (window as any).__strategy147.results.map((payload: any) => { const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
        return { sessionId: payload.sessionId, sequence: payload.sequence, status: response?.status, source: response?.result?.source,
          inputs: response?.result?.inputs, config: response?.result?.strategy?.config, audit: response?.result?.audit, error: response?.error }; }),
      localChartSettings: Object.fromEntries(Object.keys(localStorage).filter(key => key.includes("chart") || key.includes("layout")).map(key => [key, localStorage.getItem(key)])) }));
    fs.writeFileSync(path.join(directory, "observed-failure.json"), JSON.stringify({ beforeSeal, afterSeal: seal(), source: text, decodedResults: await results(page, text), lifecycle,
      alerts: await page.getByRole("alert").allTextContents(), applicationErrors: errors.get(page), opaquePlaywrightHarnessErrors: harnessErrors.get(page) }, null, 2));
    throw error;
  }
  return (await results(page, text)).findLast(predicate)!;
}
async function save(page: Page, info: TestInfo, name: string, evidence: unknown, state: Awaited<ReturnType<typeof setup>>) {
  expect(seal()).toEqual(beforeSeal); expect(testHashes()).toEqual(beforeTestHashes);
  const directory = path.join(artifacts, info.project.name); fs.mkdirSync(directory, { recursive: true });
  const workerName = fs.readdirSync("frontend/dist/assets").find(file => /^pine-native-worker.*\.js$/.test(file))!, bytes = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  expect(state.workerReceipts.length).toBeGreaterThan(0); expect(state.workerReceipts.every(receipt => receipt.sha256 === hash(bytes) && receipt.bytes === bytes.length)).toBe(true);
  fs.writeFileSync(path.join(directory, name + ".json"), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeTestHashes, afterTestHashes: testHashes(), workerName, workerSha256: hash(bytes), workerReceipts: state.workerReceipts,
    applicationErrors: errors.get(page), opaquePlaywrightHarnessErrors: harnessErrors.get(page), providerEvents: state.providerEvents, evidence,
    qualification: "Actual production live app/editor/chart/controller and opaque worker. Only current-time auth/storage/Binance transport fixtures; passive genuine-message observation and held-result delivery seam. No real exchange execution or TradingView parity claim." }, null, 2));
  await page.locator(".chart-stage").first().screenshot({ path: path.join(directory, name + ".png") });
}

test("default live strategy calculates only on actual close while next received tick fills its broker order", async ({ page }, info) => {
  const state = await setup(page), text = source("Close strategy147", false); await add(page, text, state);
  state.emit(600, 67520); const initial = await observed(page, text, result => result.sessionId && result.sequence === 0);
  const first = await observed(page, text, result => result.sessionId === initial.sessionId && result.sequence === 1);
  expect(initial.audit.bars).toBe(600); expect(first.audit.bars).toBe(601); expect(first.plots).toEqual(initial.plots);
  for (const transport of first.plotTransport) expect(transport).toMatchObject({ count: 600, slots: 601, missing: [600] });
  expect(tail(first, "Calculations")).toBe(600); expect(first.strategy.pendingOrders).toEqual([]);
  state.emit(600, 67521); const tick = await observed(page, text, result => result.sessionId === initial.sessionId && result.sequence === 2);
  expect(tick.plots).toEqual(initial.plots); expect(tick.strategy.openTrades).toEqual([]);
  state.emit(600, 67521, true); const closed = await observed(page, text, result => result.sessionId === initial.sessionId && result.sequence === 3);
  expect(tail(closed, "Calculations")).toBe(601); expect(tail(closed, "Price")).toBe(67521); expect(closed.strategy.pendingOrders).toHaveLength(1);
  state.emit(601, 67522); const filled = await observed(page, text, result => result.sessionId === initial.sessionId && result.sequence === 4);
  expect(filled.plots).toEqual(closed.plots); expect(filled.strategy.pendingOrders).toEqual([]); expect(filled.strategy.openTrades).toHaveLength(1);
  for (const transport of filled.plotTransport) expect(transport).toMatchObject({ count: 601, slots: 602, missing: [601] });
  expect(filled.strategy.openTrades[0]).toMatchObject({ entry_id: "Long147", entry_price: 67522, size: 1 });
  for (const result of [first, tick, closed, filled]) { expect(result.freshBuffers).toBe(true); expect(result.encoding).toBe("pine-packed-v1"); expect(result.retainedPreviousBufferBytes.every((bytes: number) => bytes > 0)).toBe(true); }
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1);
  await save(page, info, "close-and-next-tick", { initial, first, tick, closed, filled }, state);
});

// Only the latest authentic response is decoded for each event. Older responses
// remain available for receipts, without repeatedly scanning their plot history.
async function capacityResponse(page: Page, source: string, sessionId: string | null, sequence: number) {
  await page.waitForFunction(({ source, sessionId, sequence }) => {
    const payload = (window as any).__strategy147.latestLive[source];
    return payload && payload.sequence === sequence && (!sessionId || payload.sessionId === sessionId);
  }, { source, sessionId, sequence });
  return page.evaluate(source => {
    const payload = (window as any).__strategy147.latestLive[source], response = payload.response, result = response.result;
    return { sessionId: payload.sessionId, sequence: payload.sequence, audit: result.audit, strategy: result.strategy,
      plots: result.plots.map((plot: any) => {
        if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
        const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
        return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, index) => kinds[index] === 4 ? values[index]
          : kinds[index] === 3 ? true : kinds[index] === 2 ? false : null).filter((_, index) => kinds[index] !== 0) };
      }) };
  }, source);
}

test("one-hour live strategy keeps one candle and owner through 1025 actual provider updates", async ({ page }, info) => {
  const state = await setup(page, "1h"), text = `//@version=6
strategy("Hour capacity149",overlay=true,calc_on_every_tick=true,initial_capital=1000000)
var int ordinary=0
varip int tick=0
if barstate.isnew
    tick:=0
ordinary+=1
tick+=1
plot(ordinary,"Ordinary",display=display.none)
plot(tick,"Tick",display=display.none)
plot(close,"Price",color=#ff00ff,linewidth=3)
plot(close[1],"Prior close",display=display.none)
if barstate.isrealtime and tick==513
    strategy.entry("Late149",strategy.long,qty=1)`;
  await add(page, text, state);
  // Chart timeframe is 1h; every input event remains a genuine 1m provider event
  // for the same currently developing minute/hour. No application clock changes.
  state.emit(600, 67520);
  const first = await capacityResponse(page, text, null, 1), sessionId = first.sessionId;
  const warmup = first.audit.bars - 1;
  expect(warmup).toBeGreaterThan(0); expect(warmup).toBeLessThan(12);
  expect(tail(first, "Ordinary")).toBe(warmup + 1);
  expect(tail(first, "Tick")).toBe(1);
  const priorClose = tail(first, "Prior close"), checkpoints: any[] = [first];
  const firstSnapshot = structuredClone(first);
  let latest = first;
  for (let event = 2; event <= 1025; event++) {
    const close = 67520 + event % 7;
    state.emit(600, close);
    latest = await capacityResponse(page, text, sessionId, event);
    expect(latest.audit.bars).toBe(warmup + 1);
    for (const plot of latest.plots) expect(plot.values).toHaveLength(warmup + 1);
    expect(tail(latest, "Ordinary")).toBe(warmup + 1);
    expect(tail(latest, "Tick")).toBe(event);
    expect(tail(latest, "Price")).toBe(close);
    expect(tail(latest, "Prior close")).toBe(priorClose);
    if (event === 513) {
      expect(latest.strategy.openTrades).toEqual([]);
      expect(latest.strategy.pendingOrders).toHaveLength(1);
      expect(latest.strategy.pendingOrders[0]).toMatchObject({ id: "Late149", type: "market" });
    }
    if (event >= 514) {
      expect(latest.strategy.openTrades).toHaveLength(1);
      expect(latest.strategy.openTrades[0]).toMatchObject({ entry_id: "Late149", entry_price: 67523, size: 1, entry_bar_index: warmup });
      expect(latest.strategy.pendingOrders).toEqual([]);
      expect(latest.strategy.closedTrades).toEqual([]);
    }
    if ([512, 513, 514, 1025].includes(event)) checkpoints.push(latest);
  }
  expect(first).toEqual(firstSnapshot);
  expect(state.providerEvents).toHaveLength(1025);
  expect(new Set(state.providerEvents.map(event => event.data.k.t)).size).toBe(1);
  expect(state.providerEvents.every(event => event.data.k.i === "1m" && event.data.k.x === false)).toBe(true);
  expect(state.providerEvents.every((event, index) => index === 0 || event.data.E > state.providerEvents[index - 1].data.E)).toBe(true);
  const lifecycle = await page.evaluate(source => {
    const payloads = (window as any).__strategy147.results.filter((payload: any) => payload.protocol === "pine-live-v1" && payload.response?.result?.source === source);
    return { sessions: [...new Set(payloads.map((payload: any) => payload.sessionId))], sequences: payloads.map((payload: any) => payload.sequence),
      failed: (window as any).__strategy147.results.filter((payload: any) => payload.protocol === "pine-live-v1" && payload.response?.status === "failed") };
  }, text);
  expect(lifecycle.sessions).toEqual([sessionId]);
  expect(lifecycle.sequences).toEqual(Array.from({ length: 1026 }, (_, index) => index));
  expect(lifecycle.failed).toEqual([]);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1);
  await save(page, info, "hour-capacity149", { timeframe: "1h", providerTimeframe: "1m", receivedEvents: 1025,
    warmup, checkpoints, lifecycle, qualification: "Sequential controlled provider transport; each emission awaits its actual opaque worker response. No accelerated timers or generated worker results." }, state);
});

test("everytick broker ledger, chart inputs and execution settings retain precise session ownership", async ({ page }, info) => {
  const state = await setup(page), title = "Tick strategy147", text = source(title, true);
  await add(page, ordinarySource, state, false); const saved = await add(page, text, state);
  state.emit(600, 67520); const first = await observed(page, text, result => result.sessionId && result.sequence === 1);
  expect(tail(first, "Calculations")).toBe(601); expect(first.strategy.pendingOrders).toHaveLength(1);
  state.emit(600, 67522); const entered = await observed(page, text, result => result.sessionId === first.sessionId && result.sequence === 2);
  expect(tail(entered, "Calculations")).toBe(602); expect(tail(entered, "Position")).toBe(1);
  expect(entered.strategy.openTrades[0]).toMatchObject({ entry_id: "Long147", entry_price: 67522, size: 1 });
  state.emit(600, 67528); const exitPending = await observed(page, text, result => result.sessionId === first.sessionId && result.sequence === 3);
  expect(exitPending.strategy.openTrades).toHaveLength(1); expect(exitPending.strategy.pendingOrders).toHaveLength(1);
  state.emit(600, 67530); const exited = await observed(page, text, result => result.sessionId === first.sessionId && result.sequence === 4);
  expect(exited.strategy.closedTrades).toHaveLength(1); expect(exited.strategy.openTrades).toEqual([]);
  expect(exited.strategy.closedTrades[0]).toMatchObject({ entry_price: 67522, exit_price: 67530, size: 1 });
  const ordinary = await observed(page, ordinarySource, result => result.sessionId && result.sequence === 4);
  const trigger = page.locator(".chart-study-pill").filter({ hasText: title }).first(); await trigger.click();
  const settings = page.getByRole("group", { name: "Indicator settings", exact: true });
  await settings.locator("summary").filter({ hasText: "Live strategy results" }).click();
  await expect(settings.getByRole("region", { name: "Pine strategy results", exact: true })).toBeVisible();
  const ledger = settings.getByRole("table", { name: "Closed trades", exact: true });
  await expect(ledger).toContainText("Long147"); await ledger.scrollIntoViewIfNeeded(); await expect(ledger).toBeVisible();
  await save(page, info, "everytick-live-ledger", { first, entered, exitPending, exited }, state);
  await settings.screenshot({ path: path.join(artifacts, info.project.name, "everytick-live-ledger-controls.png") });
  await page.evaluate(({ sessionId, sequence }) => { (window as any).__strategy147.hold = { sessionId, sequence }; }, { sessionId: first.sessionId, sequence: 5 });
  state.emit(600, 67531); await expect.poll(() => page.evaluate(() => Boolean((window as any).__strategy147.held))).toBe(true);
  await settings.getByRole("spinbutton", { name: "Units", exact: true }).fill("2");
  const restarted = await observed(page, text, result => result.sessionId && result.sessionId !== first.sessionId && result.sequence === 1 && result.inputs.in_0 === 2);
  expect(tail(restarted, "Calculations")).toBe(1202);
  await page.evaluate(() => { const state = (window as any).__strategy147, held = state.held; state.hold = null; state.held = null;
    dispatchEvent(new MessageEvent("message", { data: held.data, origin: held.origin, source: held.source, ports: held.ports })); });
  await settings.locator("summary").filter({ hasText: "Strategy test settings" }).click();
  await settings.getByRole("combobox", { name: "Live calculation", exact: true }).click();
  await page.getByRole("option", { name: "At candle close", exact: true }).click();
  const changed = await observed(page, text, result => result.sessionId && result.sessionId !== restarted.sessionId && result.sequence === 1 && result.strategy.config.calc_on_every_tick === false);
  expect(tail(changed, "Calculations")).toBe(1200); const unchanged = changed.plots;
  state.emit(600, 67532); const newTick = await observed(page, text, result => result.sessionId === changed.sessionId && result.sequence === 2);
  expect(newTick.plots).toEqual(unchanged);
  const ordinaryNext = await observed(page, ordinarySource, result => result.sessionId === ordinary.sessionId && result.sequence > ordinary.sequence && tail(result, "Price") === 67532);
  expect(tail(ordinaryNext, "Ticks")).toBe(tail(ordinary, "Ticks") + 2);
  expect(state.storage.get("custom-indicator-scripts.v1").find((item: any) => item.id === saved.id)).toEqual(saved);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(2);
  await save(page, info, "restart-and-isolation", { exited, restarted, changed, newTick, ordinary, ordinaryNext }, state);
  await settings.getByTitle("Remove indicator", { exact: true }).click(); await expect(trigger).toHaveCount(0);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1);
  const afterRemoval = (await results(page, text)).length; state.emit(600, 67533);
  await observed(page, ordinarySource, result => result.sessionId === ordinary.sessionId && tail(result, "Price") === 67533);
  expect((await results(page, text)).length).toBe(afterRemoval);
  await save(page, info, "removed-strategy-owner", { afterRemoval, remainingFrames: 1 }, state);
});
