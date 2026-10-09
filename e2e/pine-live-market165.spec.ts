import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor, checkedRun } from "./pine-layering.product-support";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String)
  .filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort()
  .map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const beforeSeal = seal();
const testHashes = () => Object.fromEntries(["e2e/pine-live-market165.config.ts", "e2e/pine-live-market165.spec.ts"].map(file => [file, hash(fs.readFileSync(file))]));
const beforeTestHashes = testHashes();
const source = `//@version=6
strategy("Automatic live market165",overlay=false,calc_on_every_tick=true,initial_capital=1000000)
market=input.symbol("BINANCE:ETHUSDT","Requested market")
factor=input.int(1,"Multiplier",minval=1,maxval=4)
varip int calculations=0
calculations+=factor
plot(request.security(market,"1",close,calc_bars_count=3)*factor,"ETH close",color=#00ffff)
plot(calculations,"Calculations",display=display.none)
plot(strategy.position_size,"Position",display=display.none)
if barstate.isrealtime and strategy.position_size==0
    strategy.entry("Long165",strategy.long,qty=1)`;

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const folder = path.resolve(".artifacts/pine-live-market165", info.project.name); fs.mkdirSync(folder, { recursive: true });
  const payloads = await page.evaluate(() => ((window as any).__markets165 ?? []).map((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    return { sessionId: payload.sessionId, sequence: payload.sequence, status: response?.status, error: response?.error,
      source: response?.result?.source, inputs: response?.result?.inputs, audit: response?.result?.audit, ack: response?.ack };
  }));
  fs.writeFileSync(path.join(folder, "failure.json"), JSON.stringify({ payloads, results: await results(page), alerts: await page.getByRole("alert").allTextContents() }, null, 2));
});

async function results(page: Page) {
  return page.evaluate(source => ((window as any).__markets165 ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    return [{ source: result.source, sessionId: payload.sessionId ?? null, sequence: payload.sequence ?? null,
      inputs: result.inputs, audit: result.audit, strategy: result.strategy,
      plots: result.plots.map((plot: any) => {
        if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
        const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
        return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? values[i] : kinds[i] === 3 ? true : kinds[i] === 2 ? false : null).filter((_, i) => kinds[i] !== 0) };
      }) }];
  }), source);
}
const tail = (result: any, name: string) => result.plots.find((plot: any) => plot.name === name).values.at(-1);
async function observed(page: Page, predicate: (result: any) => boolean) {
  await expect.poll(async () => (await results(page)).some(predicate)).toBe(true);
  return (await results(page)).findLast(predicate)!;
}

test("actual live chart automatically owns requested native feeds, keeps foreign events quiet and retires changed inputs", async ({ page }, info) => {
  const errors: string[] = [], harnessErrors: string[] = [], requests: any[] = [], workers: any[] = [], sockets: any[] = [], closed: string[] = [], events: any[] = [];
  page.on("pageerror", error => {
    if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") harnessErrors.push(error.message);
    else errors.push(error.message);
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    (window as any).__markets165 = [];
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__markets165.push(event.data.payload);
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => {
    const response = await route.fetch(), bytes = await response.body();
    workers.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) });
    await route.fulfill({ response, body: bytes });
  });
  const state = await liveViewportSetup(page);
  const time = state.history.at(-1)!.time + 60;
  const remote = state.history.map((bar, index) => ({ ...bar, open: 199 + index / 5, high: 202 + index / 5, low: 198 + index / 5, close: 200 + index / 5 }));
  await page.routeWebSocket(/data-stream\.binance\.vision\/ws\/ethusdt@kline_1m$/, socket => {
    sockets.push(socket); events.push({ kind: "socket", index: sockets.length - 1, url: socket.url() });
    socket.onClose(() => { closed.push(socket.url()); events.push({ kind: "close", index: sockets.indexOf(socket) }); });
  });
  await page.route("https://data-api.binance.vision/**", async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/klines") || url.searchParams.get("symbol") !== "ETHUSDT" || !url.searchParams.has("endTime")) return route.fallback();
    const headers = route.request().headers();
    requests.push({ url: url.toString(), noAuthorization: !headers.authorization, noCookie: !headers.cookie, openedSockets: sockets.length });
    events.push({ kind: "history", request: requests.length - 1 });
    expect(url.searchParams.get("interval")).toBe("1m");
    const from = Number(url.searchParams.get("startTime")), to = Number(url.searchParams.get("endTime")), limit = Number(url.searchParams.get("limit"));
    await route.fulfill({ json: remote.filter(bar => bar.time * 1000 >= from && bar.time * 1000 <= to).slice(0, limit)
      .map(bar => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), bar.time * 1000 + 59999]) });
  });
  let eventTime = time * 1000 + 100, volume = 20;
  const emitRemote = (socket: any, close: number) => {
    const event = { e: "kline", E: ++eventTime, s: "ETHUSDT", k: { t: time * 1000, T: time * 1000 + 59999,
      i: "1m", s: "ETHUSDT", o: "340", h: "390", l: "330", c: String(close), v: String(++volume), x: false } };
    events.push({ kind: "remote", socket: sockets.indexOf(socket), event }); socket.send(JSON.stringify(event));
  };
  const dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-strategy");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source); await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((item: any) => item.source === source)).toBe(true);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const historicalBefore = (await results(page)).filter(result => !result.sessionId).length, requestsBefore = requests.length;
  state.emit(600, 67520);
  await expect.poll(() => sockets.length).toBe(1);
  expect(requests).toHaveLength(requestsBefore); // Live acquisition opens before its dated REST.
  expect((await results(page)).filter(result => result.sessionId)).toEqual([]);
  emitRemote(sockets[0], 350);
  await expect.poll(async () => (await results(page)).filter(result => !result.sessionId).length).toBeGreaterThan(historicalBefore);
  state.emit(600, 67521);
  const first = await observed(page, result => result.sessionId && tail(result, "ETH close") === 350 && tail(result, "Calculations") === 601);
  expect(first.audit.bars).toBe(601); expect(first.strategy.pendingOrders).toHaveLength(1); expect(first.strategy.openTrades).toEqual([]);
  expect(await page.locator(".chart-stage").count()).toBe(1);
  const primaryCount = (await results(page)).filter(result => result.sessionId).length;
  emitRemote(sockets[0], 360);
  await expect.poll(() => page.evaluate(id => (window as any).__markets165.some((payload: any) => payload.sessionId === id && payload.response?.ack?.streams?.some((stream: any) => stream.sequence >= 2)), first.sessionId)).toBe(true);
  expect((await results(page)).filter(result => result.sessionId)).toHaveLength(primaryCount);
  state.emit(600, 67522);
  const next = await observed(page, result => result.sessionId === first.sessionId && tail(result, "ETH close") === 360);
  expect(tail(next, "Calculations")).toBe(602); expect(next.strategy.openTrades).toHaveLength(1); expect(next.strategy.pendingOrders).toEqual([]);
  expect(next.strategy.openTrades[0]).toMatchObject({ entry_id: "Long165", entry_price: 67522, size: 1 });
  const trigger = page.locator(".chart-study-pill").filter({ hasText: "Automatic live market165" }).first(); await trigger.click();
  const settings = page.getByRole("group", { name: "Indicator settings", exact: true });
  const historicalChangedBefore = (await results(page)).filter(result => !result.sessionId && result.inputs.in_1 === 2).length;
  await settings.getByRole("spinbutton", { name: "Multiplier", exact: true }).fill("2");
  await expect.poll(() => sockets.length).toBe(2); await expect.poll(() => closed.length).toBe(1);
  emitRemote(sockets[1], 370);
  await expect.poll(async () => (await results(page)).filter(result => !result.sessionId && result.inputs.in_1 === 2).length).toBeGreaterThan(historicalChangedBefore);
  state.emit(600, 67523);
  const changed = await observed(page, result => result.sessionId && result.sessionId !== first.sessionId && result.inputs.in_1 === 2 && tail(result, "ETH close") === 740);
  expect(tail(changed, "Calculations")).toBe(1202);
  const retiredCount = (await results(page)).filter(result => result.sessionId === first.sessionId).length;
  emitRemote(sockets[1], 380); state.emit(600, 67524);
  const changedNext = await observed(page, result => result.sessionId === changed.sessionId && tail(result, "ETH close") === 760);
  expect(tail(changedNext, "Calculations")).toBe(1204);
  expect((await results(page)).filter(result => result.sessionId === first.sessionId)).toHaveLength(retiredCount);
  await settings.getByTitle("Remove indicator", { exact: true }).click();
  await expect(trigger).toHaveCount(0); await expect.poll(() => closed.length).toBe(2);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  expect(requests.every(request => request.noAuthorization && request.noCookie)).toBe(true);
  expect(errors).toEqual([]); expect(seal()).toBe(beforeSeal); expect(testHashes()).toEqual(beforeTestHashes);
  const workerName = fs.readdirSync("frontend/dist/assets").find(file => /^pine-native-worker.*\.js$/.test(file))!, worker = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  expect(workers.length).toBeGreaterThan(0); expect(workers.every(item => item.sha256 === hash(worker) && item.bytes === worker.length)).toBe(true);
  const folder = path.resolve(".artifacts/pine-live-market165", info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "receipt.json"), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeTestHashes, afterTestHashes: testHashes(),
    workerName, workerSha256: hash(worker), workers, requests, events, evidence: { first, next, changed, changedNext, retiredCount, separateMarketPane: false }, errors, harnessErrors,
    qualification: "Actual production app, editor, controller, coordinator, opaque bridge and sealed engine. Only current-time auth/storage and exact provider metadata/dated history/native socket transport are controlled; observation is passive." }, null, 2));
  await page.locator(".chart-stage").first().screenshot({ path: path.join(folder, "automatic-requested-market.png") });
});
